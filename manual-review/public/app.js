/* Manual location review — frontend logic.
 *
 * Loads the merged article list + any saved reviews, lets the user place/drag a
 * pin on a Leaflet map (starting at the article's existing coordinates when it
 * has them), read the live Wikipedia article beside it, and save the chosen
 * location. Everything persists through the tiny server in ../server.mjs.
 */

'use strict';

// The category box is sticky by design: it is not reset per article, so a whole
// run of articles gets tagged without touching it. Change it by hand whenever
// you move on to a different kind of article.
const DEFAULT_CATEGORY = 'place';

// Must match sanitizeCategory() in server.mjs so what you see is what is stored.
function normalizeCategory(v) {
  return String(v || '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 40);
}

const state = {
  articles: [], // full list from the server
  reviews: {}, // id -> { lat, lng, status, reviewedAt }
  view: [], // indices into `articles` matching the current filter
  pos: 0, // position within `view`
  filter: 'unreviewed',
  marker: null, // current pin lat/lng ({lat,lng}) or null
  image: undefined, // current image object, null (none), or undefined (loading)
  category: DEFAULT_CATEGORY, // sticky: stamped onto every save until changed
};

let map;
let markerLayer; // Leaflet marker instance or null
let renderToken = 0; // bumped each render so stale async prefills are ignored

// --- DOM handles ----------------------------------------------------------
const el = (id) => document.getElementById(id);
const dom = {
  reviewedCount: el('reviewedCount'),
  totalCount: el('totalCount'),
  progressFill: el('progressFill'),
  filterSelect: el('filterSelect'),
  categoryInput: el('categoryInput'),
  categoryOptions: el('categoryOptions'),
  positionLabel: el('positionLabel'),
  sourceBadge: el('sourceBadge'),
  articleTitle: el('articleTitle'),
  metaLine: el('metaLine'),
  hintsWrap: el('hintsWrap'),
  hintsChips: el('hintsChips'),
  geoInput: el('geoInput'),
  geoBtn: el('geoBtn'),
  geoResults: el('geoResults'),
  imgThumb: el('imgThumb'),
  imgLicense: el('imgLicense'),
  imgFilePage: el('imgFilePage'),
  imgAttribution: el('imgAttribution'),
  imgCustomBtn: el('imgCustomBtn'),
  imgClearBtn: el('imgClearBtn'),
  blurbInput: el('blurbInput'),
  loadSummaryBtn: el('loadSummaryBtn'),
  blurbCount: el('blurbCount'),
  coordsReadout: el('coordsReadout'),
  prevBtn: el('prevBtn'),
  resetBtn: el('resetBtn'),
  skipBtn: el('skipBtn'),
  saveBtn: el('saveBtn'),
  iframeTitle: el('iframeTitle'),
  openWiki: el('openWiki'),
  wikiFrame: el('wikiFrame'),
};

// --- Init -----------------------------------------------------------------

async function init() {
  map = L.map('map', { worldCopyJump: true }).setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  // Clicking an empty spot on the map drops / moves the pin.
  map.on('click', (e) => setMarker(e.latlng.lat, e.latlng.lng, true));

  const [articlesRes, reviewsRes] = await Promise.all([
    fetch('/api/articles').then((r) => r.json()),
    fetch('/api/reviews').then((r) => r.json()),
  ]);
  state.articles = articlesRes.articles;
  state.reviews = reviewsRes || {};

  dom.totalCount.textContent = state.articles.length;

  // Restore last filter + position from a previous session.
  const savedFilter = localStorage.getItem('mr.filter');
  if (savedFilter) state.filter = savedFilter;
  dom.filterSelect.value = state.filter;

  // Restore the category you were last tagging with, so a session picks up
  // where the previous one left off.
  const savedCategory = normalizeCategory(localStorage.getItem('mr.category'));
  state.category = savedCategory || DEFAULT_CATEGORY;
  dom.categoryInput.value = state.category;
  refreshCategoryOptions();

  rebuildView();

  const savedId = localStorage.getItem('mr.currentId');
  if (savedId) {
    const p = state.view.findIndex((i) => state.articles[i].id === savedId);
    if (p >= 0) state.pos = p;
  }

  wireControls();
  render();
  updateProgress();
}

// --- Category -------------------------------------------------------------

// Autocomplete suggestions = every category already used, so the set stays
// tight instead of drifting into near-duplicates.
function refreshCategoryOptions() {
  const used = new Set([DEFAULT_CATEGORY]);
  for (const r of Object.values(state.reviews)) {
    if (r && r.category) used.add(r.category);
  }
  dom.categoryOptions.innerHTML = '';
  for (const c of [...used].sort()) {
    const opt = document.createElement('option');
    opt.value = c;
    dom.categoryOptions.appendChild(opt);
  }
}

function setCategoryFromInput() {
  const next = normalizeCategory(dom.categoryInput.value);
  state.category = next;
  localStorage.setItem('mr.category', next);
}

// --- Filtering ------------------------------------------------------------

function matchesFilter(article) {
  const reviewed = !!state.reviews[article.id];
  switch (state.filter) {
    case 'unreviewed':
      return !reviewed;
    case 'reviewed':
      return reviewed;
    case 'ner':
      return article.source === 'ner';
    case 'good':
      return article.source === 'good';
    default:
      return true;
  }
}

function rebuildView() {
  const currentId = state.view[state.pos] != null ? state.articles[state.view[state.pos]].id : null;
  state.view = state.articles.map((_, i) => i).filter((i) => matchesFilter(state.articles[i]));
  // Try to keep the user near where they were.
  if (currentId) {
    const p = state.view.findIndex((i) => state.articles[i].id === currentId);
    state.pos = p >= 0 ? p : 0;
  } else {
    state.pos = 0;
  }
  if (state.pos >= state.view.length) state.pos = Math.max(0, state.view.length - 1);
}

// --- Rendering ------------------------------------------------------------

function currentArticle() {
  const idx = state.view[state.pos];
  return idx == null ? null : state.articles[idx];
}

function render() {
  const token = ++renderToken; // invalidate any in-flight summary prefill
  const a = currentArticle();
  clearGeoResults();

  if (!a) {
    dom.articleTitle.textContent = 'Nothing to review in this filter 🎉';
    dom.sourceBadge.textContent = '—';
    dom.sourceBadge.className = 'badge';
    dom.metaLine.textContent = '';
    dom.hintsWrap.hidden = true;
    dom.iframeTitle.textContent = '—';
    dom.wikiFrame.removeAttribute('src');
    dom.positionLabel.textContent = `0 / 0`;
    dom.blurbInput.value = '';
    updateBlurbCount();
    state.image = null;
    renderImage();
    setMarkerObject(null);
    updateCoordsReadout();
    updateButtons();
    return;
  }

  localStorage.setItem('mr.currentId', a.id);

  const review = state.reviews[a.id];

  // Badge + title
  dom.articleTitle.textContent = a.title;
  if (review) {
    dom.sourceBadge.textContent = review.status === 'skipped' ? 'skipped' : 'reviewed';
    dom.sourceBadge.className = 'badge reviewed';
  } else {
    dom.sourceBadge.textContent = a.source === 'good' ? 'good' : 'NER';
    dom.sourceBadge.className = 'badge ' + a.source;
  }

  // Meta line
  const meta = [];
  if (a.source === 'good') {
    meta.push('has coordinates');
    if (a.sourceProp) meta.push('via ' + a.sourceProp + (a.resolvedVia ? ' → ' + a.resolvedVia : ''));
    if (a.qid) meta.push(a.qid);
  } else {
    meta.push('no coordinates — place a pin');
  }
  if (review) {
    // Show what this article was tagged as. The box above stays sticky, so this
    // is how you spot an article saved under a category you've since moved on
    // from — re-saving restamps it with whatever the box currently says.
    if (review.category) meta.push('tagged “' + review.category + '”');
    meta.push(
      `${review.status} ${review.reviewedAt ? '· ' + new Date(review.reviewedAt).toLocaleString() : ''}`,
    );
  }
  dom.metaLine.textContent = meta.join('  ·  ');

  // Hints (NER entity names)
  if (a.hints && a.hints.length) {
    dom.hintsWrap.hidden = false;
    dom.hintsChips.innerHTML = '';
    for (const h of a.hints) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.innerHTML = `${escapeHtml(h.name)}${h.count > 1 ? `<span class="count">×${h.count}</span>` : ''}`;
      chip.addEventListener('click', () => geocodeInto(h.name, chip));
      dom.hintsChips.appendChild(chip);
    }
  } else {
    dom.hintsWrap.hidden = true;
  }

  // Iframe
  dom.iframeTitle.textContent = a.title;
  dom.openWiki.href = a.wikiUrl;
  dom.wikiFrame.src = a.wikiUrl;

  // Position label
  dom.positionLabel.textContent = `${state.pos + 1} / ${state.view.length}`;

  // Blurb + image: show the saved values, otherwise pull candidates from the
  // Wikipedia summary. A saved review always wins; the async prefill is guarded
  // by the render token and only fills empty/unset fields, so it can never
  // clobber saved data or something you're typing.
  const hasSavedBlurb = !!(review && review.blurb);
  const hasSavedImage = !!(review && Object.prototype.hasOwnProperty.call(review, 'image'));
  dom.blurbInput.value = hasSavedBlurb ? review.blurb : '';
  updateBlurbCount();
  state.image = hasSavedImage ? review.image : undefined; // undefined => loading
  renderImage();
  loadMedia(a.title, token, hasSavedBlurb, hasSavedImage);

  // Initial pin: saved review location > original coordinates > none.
  let lat = null;
  let lng = null;
  if (review && Number.isFinite(review.lat) && Number.isFinite(review.lng)) {
    lat = review.lat;
    lng = review.lng;
  } else if (a.hasCoord) {
    lat = a.lat;
    lng = a.lng;
  }

  if (lat != null && lng != null) {
    setMarker(lat, lng, false);
    map.setView([lat, lng], Math.max(map.getZoom(), 6));
  } else {
    setMarkerObject(null);
    map.setView([20, 0], 2);
  }

  updateButtons();
}

// --- Marker handling ------------------------------------------------------

function setMarkerObject(latlng) {
  if (markerLayer) {
    map.removeLayer(markerLayer);
    markerLayer = null;
  }
  state.marker = latlng;
  if (latlng) {
    markerLayer = L.marker([latlng.lat, latlng.lng], { draggable: true }).addTo(map);
    markerLayer.on('dragend', () => {
      const p = markerLayer.getLatLng();
      state.marker = { lat: p.lat, lng: p.lng };
      updateCoordsReadout();
    });
  }
  updateCoordsReadout();
}

function setMarker(lat, lng, pan) {
  setMarkerObject({ lat, lng });
  if (pan) map.panTo([lat, lng]);
  updateButtons();
}

function updateCoordsReadout() {
  if (state.marker) {
    dom.coordsReadout.textContent = `Pin: ${state.marker.lat.toFixed(5)}, ${state.marker.lng.toFixed(5)}`;
    dom.coordsReadout.classList.add('set');
  } else {
    dom.coordsReadout.textContent = 'No pin placed yet — click the map or a hint.';
    dom.coordsReadout.classList.remove('set');
  }
}

// --- Geocoding ------------------------------------------------------------

async function geocodeInto(query, chipEl) {
  if (chipEl) chipEl.classList.add('loading');
  try {
    const res = await fetch('/api/geocode?q=' + encodeURIComponent(query)).then((r) => r.json());
    const results = res.results || [];
    if (!results.length) {
      showGeoResults([{ name: `No match for “${query}”`, lat: null, lng: null }]);
      return;
    }
    // Jump the pin to the top hit immediately, and list alternatives.
    const top = results[0];
    setMarker(top.lat, top.lng, true);
    map.setView([top.lat, top.lng], 9);
    showGeoResults(results);
  } catch (err) {
    showGeoResults([{ name: 'Geocoding failed: ' + err.message, lat: null, lng: null }]);
  } finally {
    if (chipEl) chipEl.classList.remove('loading');
  }
}

function showGeoResults(results) {
  dom.geoResults.hidden = false;
  dom.geoResults.innerHTML = '';
  for (const r of results) {
    const div = document.createElement('div');
    div.className = 'r';
    div.textContent = r.name;
    if (Number.isFinite(r.lat) && Number.isFinite(r.lng)) {
      div.addEventListener('click', () => {
        setMarker(r.lat, r.lng, true);
        map.setView([r.lat, r.lng], 10);
      });
    }
    dom.geoResults.appendChild(div);
  }
}

function clearGeoResults() {
  dom.geoResults.hidden = true;
  dom.geoResults.innerHTML = '';
  dom.geoInput.value = '';
}

// --- Blurb & image --------------------------------------------------------

const mediaCache = new Map();
async function fetchMedia(title) {
  if (mediaCache.has(title)) return mediaCache.get(title);
  const p = fetch('/api/media?title=' + encodeURIComponent(title)).then((r) => {
    if (!r.ok) throw new Error('media HTTP ' + r.status);
    return r.json();
  });
  mediaCache.set(title, p);
  p.catch(() => mediaCache.delete(title)); // don't cache failures
  return p;
}

// Auto-fill teaser + candidate image on article change. Guarded by the render
// token; only fills fields the user hasn't already saved or typed.
async function loadMedia(title, token, hasSavedBlurb, hasSavedImage) {
  let media;
  try {
    media = await fetchMedia(title);
  } catch {
    if (token === renderToken && state.image === undefined) {
      state.image = null; // stop the "loading" spinner
      renderImage();
    }
    return;
  }
  if (token !== renderToken) return;
  if (!hasSavedBlurb && dom.blurbInput.value.trim() === '') {
    dom.blurbInput.value = media.teaser || '';
    updateBlurbCount();
  }
  if (!hasSavedImage && state.image === undefined) {
    state.image = media.image || null;
    renderImage();
  }
}

// Button: pull the full Wikipedia summary into the blurb for more raw material.
async function loadSummary() {
  const a = currentArticle();
  if (!a) return;
  dom.loadSummaryBtn.disabled = true;
  try {
    const media = await fetchMedia(a.title);
    dom.blurbInput.value = media.extract || media.teaser || '';
    updateBlurbCount();
  } catch (err) {
    flash(dom.coordsReadout, 'Could not load summary: ' + err.message);
  } finally {
    dom.loadSummaryBtn.disabled = false;
  }
}

function updateBlurbCount() {
  dom.blurbCount.textContent = String(dom.blurbInput.value.trim().length);
}

// Render the image widget from state.image (undefined = loading, null = none).
function renderImage() {
  const img = state.image;
  const thumb = dom.imgThumb;

  if (img === undefined) {
    thumb.style.backgroundImage = '';
    thumb.innerHTML = '<span class="img-msg">Loading…</span>';
    dom.imgLicense.textContent = '';
    dom.imgLicense.className = 'img-license';
    dom.imgFilePage.hidden = true;
    dom.imgAttribution.value = '';
    return;
  }

  if (!img || !img.thumbUrl) {
    thumb.style.backgroundImage = '';
    thumb.innerHTML = '<span class="img-msg">No image</span>';
    dom.imgLicense.textContent = 'no image';
    dom.imgLicense.className = 'img-license';
    dom.imgFilePage.hidden = true;
    dom.imgAttribution.value = img && img.attribution ? img.attribution : '';
    return;
  }

  thumb.innerHTML = '';
  thumb.style.backgroundImage = `url("${img.thumbUrl.replace(/"/g, '%22')}")`;
  dom.imgLicense.textContent = img.license || 'license unknown';
  dom.imgLicense.className = 'img-license ' + (img.nonFree ? 'nonfree' : img.license ? 'free' : '');
  if (img.filePage) {
    dom.imgFilePage.hidden = false;
    dom.imgFilePage.href = img.filePage;
  } else {
    dom.imgFilePage.hidden = true;
  }
  dom.imgAttribution.value = img.attribution || '';
}

function clearImage() {
  state.image = null;
  renderImage();
}

function customImage() {
  const url = window.prompt('Image URL to use for this location:', state.image?.fullUrl || '');
  if (url == null) return;
  const trimmed = url.trim();
  if (!trimmed) {
    clearImage();
    return;
  }
  state.image = {
    thumbUrl: trimmed,
    fullUrl: trimmed,
    filePage: '',
    license: '',
    attribution: dom.imgAttribution.value.trim(),
    nonFree: false,
  };
  renderImage();
}

// --- Saving & navigation --------------------------------------------------

async function postReview(id, payload) {
  const res = await fetch('/api/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...payload }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'save failed');
  }
  const data = await res.json();
  if (data.review) state.reviews[id] = data.review;
  else delete state.reviews[id];
}

// Build the image to store, folding in any live edit of the attribution field.
function currentImagePayload() {
  if (!state.image) return null;
  return { ...state.image, attribution: dom.imgAttribution.value.trim() };
}

async function saveAndNext() {
  const a = currentArticle();
  if (!a) return;
  if (!state.marker) {
    flash(dom.coordsReadout, 'Place a pin first (click the map or a hint).');
    return;
  }
  try {
    await postReview(a.id, {
      title: a.title,
      lat: state.marker.lat,
      lng: state.marker.lng,
      blurb: dom.blurbInput.value.trim(),
      image: currentImagePayload(),
      category: state.category,
      status: 'confirmed',
    });
    refreshCategoryOptions();
    updateProgress();
    advanceAfterReview();
  } catch (err) {
    flash(dom.coordsReadout, 'Save failed: ' + err.message);
  }
}

async function skip() {
  const a = currentArticle();
  if (!a) return;
  try {
    await postReview(a.id, {
      title: a.title,
      lat: state.marker ? state.marker.lat : null,
      lng: state.marker ? state.marker.lng : null,
      blurb: dom.blurbInput.value.trim(),
      image: currentImagePayload(),
      category: state.category,
      status: 'skipped',
    });
    refreshCategoryOptions();
    updateProgress();
    advanceAfterReview();
  } catch (err) {
    flash(dom.coordsReadout, 'Save failed: ' + err.message);
  }
}

// After reviewing, move forward. If the current filter hides reviewed items,
// the item just left in place, so staying at the same position shows the next
// unreviewed one; otherwise step forward by one.
function advanceAfterReview() {
  const hidesReviewed = state.filter === 'unreviewed';
  if (hidesReviewed) {
    rebuildView(); // current item drops out of the view
    render();
  } else {
    next();
  }
}

function next() {
  if (state.pos < state.view.length - 1) {
    state.pos++;
    render();
  }
}

function prev() {
  if (state.pos > 0) {
    state.pos--;
    render();
  }
}

function resetPin() {
  const a = currentArticle();
  if (!a) return;
  if (a.hasCoord) {
    setMarker(a.lat, a.lng, true);
    map.setView([a.lat, a.lng], Math.max(map.getZoom(), 6));
  } else {
    setMarkerObject(null);
    updateButtons();
  }
}

// --- UI state -------------------------------------------------------------

function updateButtons() {
  const a = currentArticle();
  dom.prevBtn.disabled = state.pos <= 0;
  dom.saveBtn.disabled = !a || !state.marker;
  dom.skipBtn.disabled = !a;
  dom.resetBtn.disabled = !a;
}

function updateProgress() {
  const n = Object.keys(state.reviews).length;
  dom.reviewedCount.textContent = n;
  const pct = state.articles.length ? (n / state.articles.length) * 100 : 0;
  dom.progressFill.style.width = pct.toFixed(1) + '%';
}

let flashTimer = null;
function flash(node, msg) {
  const prevSet = node.classList.contains('set');
  node.textContent = msg;
  node.classList.add('set');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    updateCoordsReadout();
    if (!prevSet) node.classList.remove('set');
  }, 2200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

// --- Wiring ---------------------------------------------------------------

function wireControls() {
  dom.saveBtn.addEventListener('click', saveAndNext);
  dom.skipBtn.addEventListener('click', skip);
  dom.prevBtn.addEventListener('click', prev);
  dom.resetBtn.addEventListener('click', resetPin);

  dom.filterSelect.addEventListener('change', () => {
    state.filter = dom.filterSelect.value;
    localStorage.setItem('mr.filter', state.filter);
    rebuildView();
    render();
  });

  dom.categoryInput.addEventListener('input', setCategoryFromInput);
  dom.categoryInput.addEventListener('change', () => {
    setCategoryFromInput();
    dom.categoryInput.value = state.category; // reflect the normalised form
  });
  // Enter in the category box shouldn't fall through to Save & Next.
  dom.categoryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      dom.categoryInput.blur();
    }
  });

  dom.loadSummaryBtn.addEventListener('click', loadSummary);
  dom.blurbInput.addEventListener('input', updateBlurbCount);
  dom.imgClearBtn.addEventListener('click', clearImage);
  dom.imgCustomBtn.addEventListener('click', customImage);
  dom.imgAttribution.addEventListener('input', () => {
    if (state.image) state.image.attribution = dom.imgAttribution.value;
  });

  dom.geoBtn.addEventListener('click', () => {
    const q = dom.geoInput.value.trim();
    if (q) geocodeInto(q, null);
  });
  dom.geoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = dom.geoInput.value.trim();
      if (q) geocodeInto(q, null);
    }
  });

  document.addEventListener('keydown', (e) => {
    // Ignore shortcuts while typing in any text field. Matching on the element
    // type rather than a list of ids means a newly added input (like the
    // category box) can't accidentally trigger `s` = skip.
    if (e.target instanceof HTMLElement && e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') {
      prev();
    } else if (e.key === 'ArrowRight') {
      next();
    } else if (e.key === 'Enter') {
      saveAndNext();
    } else if (e.key === 's' || e.key === 'S') {
      skip();
    }
  });
}

init().catch((err) => {
  document.getElementById('articleTitle').textContent = 'Failed to start: ' + err.message;
  console.error(err);
});
