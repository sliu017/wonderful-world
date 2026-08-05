// Manual-review tool server.
//
// Zero external dependencies (uses Node's built-in http/fs and global fetch,
// available in Node >= 18). Serves the review UI, merges the two source data
// files into a single article list, persists reviewed locations to reviews.json,
// and proxies geocoding requests to Nominatim so the browser never hits CORS or
// leaks a bad User-Agent.
//
// Run:  node manual-review/server.mjs   (or: npm run review)

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const SCRIPTS_DIR = path.join(ROOT, '..', 'scripts/data');
const GOOD_PATH = path.join(SCRIPTS_DIR, 'group_with_direct_coords.json');
const NER_PATH = path.join(SCRIPTS_DIR, 'ner_results.json');
const REVIEWS_PATH = process.env.REVIEWS_PATH || path.join(ROOT, 'reviews.json');

const PORT = Number(process.env.PORT) || 5174;
const USER_AGENT =
  'wonderful-world-manual-review/1.0 (local review tool; contact: sebastiansliu@gmail.com)';

// ---------------------------------------------------------------------------
// Build the merged article list once at startup.
// ---------------------------------------------------------------------------

function wikiUrl(title) {
  // Wikipedia uses underscores for spaces; encodeURIComponent leaves
  // underscores and parentheses untouched but escapes the tricky characters.
  return 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
}

function loadArticles() {
  const good = JSON.parse(fs.readFileSync(GOOD_PATH, 'utf8'));
  const ner = JSON.parse(fs.readFileSync(NER_PATH, 'utf8'));

  const articles = [];

  // group_with_direct_coords.json: keyed by Wikidata Q-id, each already carries coordinates.
  for (const [qid, v] of Object.entries(good)) {
    const lat = v?.coords?.lat;
    const lng = v?.coords?.lng;
    const hasCoord = Number.isFinite(lat) && Number.isFinite(lng);
    articles.push({
      id: 'good:' + qid,
      qid,
      title: v.title,
      source: 'good',
      hasCoord,
      lat: hasCoord ? lat : null,
      lng: hasCoord ? lng : null,
      sourceProp: v.source_prop ?? null,
      resolvedVia: v.resolved_via ?? null,
      wikiUrl: wikiUrl(v.title),
      hints: [],
    });
  }

  // ner_results.json: keyed by article title, value is { entityName: count }.
  // (Filename unchanged by the restructure; still lives in scripts/data/.)
  // No coordinates — the entity names become geocodable hint chips.
  for (const [title, entities] of Object.entries(ner)) {
    const hints = Object.entries(entities)
      .map(([name, count]) => ({ name, count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count);
    articles.push({
      id: 'ner:' + title,
      qid: null,
      title,
      source: 'ner',
      hasCoord: false,
      lat: null,
      lng: null,
      sourceProp: null,
      resolvedVia: null,
      wikiUrl: wikiUrl(title),
      hints,
    });
  }

  return articles;
}

let ARTICLES = [];
try {
  ARTICLES = loadArticles();
  console.log(
    `Loaded ${ARTICLES.length} articles ` +
      `(${ARTICLES.filter((a) => a.source === 'good').length} with coords, ` +
      `${ARTICLES.filter((a) => a.source === 'ner').length} needing a location).`,
  );
} catch (err) {
  console.error('Failed to load source data files:', err.message);
  process.exit(1);
}

// Fast id -> title lookup (local, no network). Used to stamp the article title
// onto every saved review so reviews.json stays human-readable on its own.
const titleById = new Map(ARTICLES.map((a) => [a.id, a.title]));

// ---------------------------------------------------------------------------
// Reviews persistence. reviews.json maps article id -> saved review.
// Kept in memory and written atomically (temp file + rename) on every save so
// a crash mid-write can never corrupt the stored data.
// ---------------------------------------------------------------------------

let reviews = {};
try {
  if (fs.existsSync(REVIEWS_PATH)) {
    reviews = JSON.parse(fs.readFileSync(REVIEWS_PATH, 'utf8'));
    console.log(`Loaded ${Object.keys(reviews).length} existing reviews.`);
  }
} catch (err) {
  console.error(`Could not read ${REVIEWS_PATH}, starting empty:`, err.message);
  reviews = {};
}

// Backfill the title onto any review saved before titles were stored. Purely a
// local lookup — no API calls — and only rewrites the file if something changed.
let backfilled = 0;
for (const [id, r] of Object.entries(reviews)) {
  if (r && !r.title && titleById.has(id)) {
    reviews[id] = { title: titleById.get(id), ...r }; // title first, for readable diffs
    backfilled++;
  }
}

let writeChain = Promise.resolve();
function persistReviews() {
  // Serialize writes so overlapping saves never interleave.
  writeChain = writeChain.then(async () => {
    const tmp = REVIEWS_PATH + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(reviews, null, 2));
    await fsp.rename(tmp, REVIEWS_PATH);
  });
  return writeChain;
}

if (backfilled) {
  persistReviews();
  console.log(`Backfilled titles onto ${backfilled} existing review(s).`);
}

// ---------------------------------------------------------------------------
// Wikipedia media: teaser text + candidate lead image with license/attribution.
//
// One /api/media call per article gathers everything the reviewer needs to
// approve a pin popup: a short teaser (seeded from the same summary the hover
// "Page Preview" shows), and the lead image's URL, Commons/Wikipedia file page,
// license, attribution string, and a non-free flag. Results are cached so
// navigating back to an article is instant.
// ---------------------------------------------------------------------------

const SUMMARY_BASE = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const API_BASE = 'https://en.wikipedia.org/w/api.php';
const mediaCache = new Map();

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Split into sentences, keeping common abbreviations (Inc., Mr., St. …) intact.
const ABBR = new Set([
  'inc', 'ltd', 'co', 'corp', 'mr', 'mrs', 'ms', 'dr', 'st', 'mt', 'vs',
  'etc', 'no', 'vol', 'gen', 'sen', 'rev', 'jr', 'sr', 'e.g', 'i.e',
]);
function firstSentences(text, max = 2) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  const chunks = clean.match(/[^.!?]*[.!?]+["'”’)]*\s*/g) || [clean];
  const out = [];
  for (const raw of chunks) {
    const piece = raw.trim();
    const prev = out[out.length - 1];
    const lastWord = prev ? prev.split(/\s+/).pop().replace(/[.!?]+$/, '').toLowerCase() : '';
    if (prev && ABBR.has(lastWord)) {
      out[out.length - 1] = prev + ' ' + piece; // merged an abbreviation split
    } else {
      out.push(piece);
      if (out.length >= max) break;
    }
  }
  return out.join(' ').trim();
}

function buildAttribution(credit, license, repo, nonFree) {
  if (nonFree) return (license || 'Non-free') + ' — non-free, not for reuse';
  const source = repo === 'shared' ? 'Wikimedia Commons' : 'Wikipedia';
  const who = credit || 'Unknown author';
  return license ? `${who}, ${license}, via ${source}` : `${who}, via ${source}`;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function getMedia(title) {
  if (mediaCache.has(title)) return mediaCache.get(title);
  const result = { extract: '', teaser: '', image: null };
  try {
    const s = await fetchJson(SUMMARY_BASE + encodeURIComponent(title));
    result.extract = (s.extract || '').trim();
    result.teaser = firstSentences(result.extract, 2);

    const full = s.originalimage?.source;
    const thumb = s.thumbnail?.source;
    if (full) {
      const fileName = decodeURIComponent(full.split('/').pop());
      const image = {
        thumbUrl: thumb || full,
        fullUrl: full,
        filePage: '',
        license: '',
        attribution: '',
        nonFree: false,
      };
      try {
        const q =
          `${API_BASE}?action=query&format=json&origin=*` +
          `&prop=imageinfo&iiprop=url|extmetadata&titles=` +
          encodeURIComponent('File:' + fileName);
        const j = await fetchJson(q);
        const page = Object.values(j.query.pages)[0];
        const ii = page.imageinfo?.[0];
        const em = ii?.extmetadata || {};
        const val = (k) => em[k]?.value;
        image.filePage = ii?.descriptionurl || '';
        image.license = stripHtml(val('LicenseShortName') || '');
        image.nonFree =
          String(val('NonFree') || '').toLowerCase() === 'true' ||
          (val('License') == null && /fair use|non-?free/i.test(image.license));
        const credit = stripHtml(val('Attribution') || val('Artist') || '');
        image.attribution = buildAttribution(credit, image.license, page.imagerepository, image.nonFree);
      } catch {
        // Image usable even if we couldn't resolve its licensing.
      }
      result.image = image;
    }
  } catch {
    // No summary (rare) — reviewer just writes the teaser by hand.
  }
  mediaCache.set(title, result);
  return result;
}

// Categories are free text typed by the reviewer, so normalise them (trim,
// collapse whitespace, lowercase) to keep "Place", "place " and "place" from
// becoming three different tags.
const MAX_CATEGORY_LEN = 40;
function sanitizeCategory(v) {
  if (typeof v !== 'string') return '';
  return v.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, MAX_CATEGORY_LEN);
}

function sanitizeImage(img) {
  if (!img || typeof img !== 'object') return null;
  const str = (k) => (typeof img[k] === 'string' ? img[k] : '');
  return {
    thumbUrl: str('thumbUrl'),
    fullUrl: str('fullUrl'),
    filePage: str('filePage'),
    license: str('license'),
    attribution: str('attribution'),
    nonFree: !!img.nonFree,
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers.
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  // Prevent path traversal outside PUBLIC_DIR.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      // Local dev tool: never serve a stale app.js/css after a code change.
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

// ---------------------------------------------------------------------------
// Request router.
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // --- API --------------------------------------------------------------
    if (pathname === '/api/articles' && req.method === 'GET') {
      return sendJson(res, 200, { total: ARTICLES.length, articles: ARTICLES });
    }

    if (pathname === '/api/reviews' && req.method === 'GET') {
      return sendJson(res, 200, reviews);
    }

    if (pathname === '/api/reviews' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const { id, lat, lng, status, blurb, image, category, title: bodyTitle } = body;
      if (typeof id !== 'string') return sendJson(res, 400, { error: 'id required' });

      if (status === 'unreviewed') {
        // Clearing a review.
        delete reviews[id];
      } else {
        if (status === 'confirmed' && (!Number.isFinite(lat) || !Number.isFinite(lng))) {
          return sendJson(res, 400, { error: 'lat/lng required to confirm' });
        }
        // Title comes from the local article map first (authoritative); the
        // value the client sends is just a fallback.
        const title = titleById.get(id) || (typeof bodyTitle === 'string' ? bodyTitle : '');
        reviews[id] = {
          title,
          // stamped from whatever the reviewer currently has in the Category
          // box; falls back to the previous value so re-saving with an empty
          // box doesn't silently drop an existing tag
          category: sanitizeCategory(category) || reviews[id]?.category || '',
          lat: Number.isFinite(lat) ? lat : null,
          lng: Number.isFinite(lng) ? lng : null,
          blurb: typeof blurb === 'string' ? blurb : '',
          image: sanitizeImage(image),
          status: status || 'confirmed',
          reviewedAt: new Date().toISOString(),
        };
      }
      await persistReviews();
      return sendJson(res, 200, { ok: true, id, review: reviews[id] ?? null });
    }

    if (pathname === '/api/media' && req.method === 'GET') {
      const title = url.searchParams.get('title');
      if (!title) return sendJson(res, 400, { error: 'title required' });
      return sendJson(res, 200, await getMedia(title));
    }

    if (pathname === '/api/geocode' && req.method === 'GET') {
      const q = url.searchParams.get('q');
      if (!q) return sendJson(res, 400, { error: 'q required' });
      const nomUrl =
        'https://nominatim.openstreetmap.org/search?format=json&limit=5&q=' +
        encodeURIComponent(q);
      try {
        const r = await fetch(nomUrl, { headers: { 'User-Agent': USER_AGENT } });
        const data = await r.json();
        const results = (Array.isArray(data) ? data : []).map((d) => ({
          name: d.display_name,
          lat: Number(d.lat),
          lng: Number(d.lon),
        }));
        return sendJson(res, 200, { results });
      } catch (err) {
        return sendJson(res, 502, { error: 'geocode failed', detail: err.message });
      }
    }

    // --- Static ------------------------------------------------------------
    return serveStatic(res, pathname);
  } catch (err) {
    console.error('Request error:', err);
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`\n  Manual review tool running at:  http://localhost:${PORT}\n`);
  console.log(`  Reviews are saved to: ${REVIEWS_PATH}\n`);
});
