# Manual Location Review

A small standalone tool for hand-checking a map location for every article in
`scripts/good_group.json` and `scripts/ner_results.json` (3,228 articles total).

For each article you get the **live Wikipedia page** on the right to read, and a
**draggable map pin** on the left. Drop / drag the pin, write a short **teaser**
(auto-seeded from the article's first sentence or two — the same text Wikipedia's
hover preview shows), confirm the **lead image** (auto-fetched with its license
and attribution), then save. Everything lands in `manual-review/reviews.json`,
ready to drive the pin popups (image + teaser + link) in the app.

## Run

```bash
npm run review          # or: node manual-review/server.mjs
```

Then open <http://localhost:5174>. (Set `PORT=xxxx` to change the port.)

No build step and no extra dependencies — the server uses only Node built-ins
(Node ≥ 18), and the page loads Leaflet from a CDN.

## What you're reviewing

- **`good` articles** (1,782) already have coordinates from Wikidata. The pin
  starts on those coordinates so you just confirm or nudge them.
- **`NER` articles** (1,446) have no coordinates. They show place-name **hint
  chips** pulled from the article by the NER pass — click one to geocode it and
  drop the pin there, or use the free-text "Search a place" box, or just click
  the map.

## Controls

- **Teaser** — auto-seeded with the first sentence or two; edit into a hook, or
  hit **↻ Wikipedia summary** to pull the full summary as raw material.
- **Image** — the article's lead image is fetched automatically with its
  **license** (green = reusable, orange = ⚠ non-free / don't reuse), an editable
  **attribution** line, and a link to the file page. Use **Custom URL…** to
  supply your own, or **Clear image** for none.
- **Tagging as** (top right) — the category stamped onto every article you
  save. It is **sticky**: it does not change as you move between articles, so a
  whole run gets the same tag. Edit it by hand when you switch to a different
  kind of article. Previously used categories autocomplete, and the value is
  normalised (trimmed, lowercased) so `Place` and `place ` don't split into two
  tags. An already-reviewed article shows its own saved tag in the meta line.
- **Save & Next** (`Enter`) — stores the pin + teaser + image as `confirmed` and advances.
- **Skip** (`s`) — marks the article `skipped` (revisit later via the filter).
- **Prev / Next** (`←` / `→`) — move without saving.
- **Reset pin** — back to the original coordinates (or clear it for NER items).
- **Filter** (top right) — All / Unreviewed / Reviewed / NER / good. Your filter
  and place in the list are remembered between sessions.

## Output: `reviews.json`

Keyed by article id (`good:<Qid>` or `ner:<Title>`):

```json
{
  "ner:Zheltuga Republic": {
    "title": "Zheltuga Republic",
    "category": "place",
    "lat": 53.6,
    "lng": 124.0,
    "blurb": "A gold-rush micro-republic that most maps forgot.",
    "image": {
      "thumbUrl": "https://upload.wikimedia.org/.../330px-....png",
      "fullUrl": "https://upload.wikimedia.org/.../....png",
      "filePage": "https://commons.wikimedia.org/wiki/File:....png",
      "license": "CC BY-SA 4.0",
      "attribution": "Personyash27, CC BY-SA 4.0, via Wikimedia Commons",
      "nonFree": false
    },
    "status": "confirmed",
    "reviewedAt": "2026-07-26T12:00:00.000Z"
  }
}
```

- `status` is `confirmed` or `skipped`; `image` is `null` if there's none.
- `category` is whatever the **Tagging as** box held at save time. Re-saving an
  article restamps it with the current box value; saving with the box empty
  keeps the tag the article already had rather than clearing it.
- `thumbUrl` is what you'd hotlink in a popup; `fullUrl` / `filePage` let a later
  step download and self-host the image (with `attribution`) if you stop
  hotlinking. `nonFree: true` means the image is fair-use on Wikipedia and should
  **not** be reused off-site — swap or clear it before publishing.
- Writes are atomic (temp file + rename), so an interrupted save can't corrupt
  the file. Re-saving an article overwrites its entry, so you can revise anytime.
