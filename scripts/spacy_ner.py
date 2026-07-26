import spacy
import requests
import json

nlp = spacy.load("en_core_web_sm")
HEADERS = {
    "User-Agent": "Wonderful World Project/0.1 (https://github.com/sliu017)"
}
WP_URL = "https://en.wikipedia.org/w/api.php" # wikipedia, not wikidata

def batched(items, batch_size):
    res = []
    for i in range(0, len(items), batch_size):
        res.append(items[i:i+batch_size])
    return res

def get_article_text(batch):
    # given a batch of titles, return the text of all articles
    params = {
        "action": "query",
        "format": "json",
        "titles": "|".join(batch),  # batch of up to 20 titles
        "prop": "extracts",
        "exintro": "1",
        "explaintext": "1",
        "exlimit": "max"
    }
    r = requests.get(url=WP_URL, params=params, headers=HEADERS)
    data = r.json()
    pages = data.get("query", {}).get("pages", {})
    if not pages:
        return None
    results = {}
    for page in pages.values():
        title = page.get("title")
        extract = page.get("extract")
        if title and extract:
            results[title] = extract
    return results

with open("./run_through_ner.json", "r") as f:
    unresolved = json.load(f)

titles = list(unresolved.values())
all_extracted_summaries = {}
for batch in batched(titles, 20): # Batch size might be 50, not sure
    results = get_article_text(batch)
    if results:
        all_extracted_summaries.update(results)

found_location_info = {}
still_unresolved = {}
for id, title in unresolved.items():
    extract = all_extracted_summaries.get(title)
    if not extract:
        continue
    doc = nlp(extract)
    locations_found = {}
    for ent in doc.ents:
        if ent.label_ == "GPE" or ent.label_ == "LOC":
            if(ent.text not in locations_found):
                locations_found[ent.text] = 0
            locations_found[ent.text] += 1
    sorted_location_info = dict(sorted(locations_found.items(), key=lambda item: item[1], reverse = True))
    if sorted_location_info:
        found_location_info[title] = sorted_location_info
    else:
        still_unresolved[id] = title

with open("ner_results.json", "w") as f:
    json.dump(found_location_info, f, indent=4)
with open("still_unresolved.json", "w") as f:
    json.dump(still_unresolved, f, indent=4)    

