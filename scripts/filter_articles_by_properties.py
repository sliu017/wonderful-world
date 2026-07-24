import json
import requests
import time


HEADERS = {
    "User-Agent": "Wonderful World Project/0.1 (https://github.com/sliu017)"
}
WD_URL = "https://www.wikidata.org/w/api.php"
BATCH_SIZE = 50

# these property tags are all at least tangentially related to location, and since we're casting a wide net, we check for them all
LOCATION_PROPS = ["P625", "P19", "P20", "P276", "P131", "P17", "P159", "P840", "P937", "P706"]


def get_entities_by_title(titles):
    # from a list of <= 50 titles, return a dict with {ID: entity_data}
    params = {
        "action": "wbgetentities",
        "format": "json",
        "sites": "enwiki",
        "props": "claims|sitelinks",
        "titles": "|".join(titles)
    }
    r = requests.get(url=WD_URL, params=params, headers=HEADERS)
    data = r.json()
    entities = data.get("entities", {})
    return {qid: e for qid, e in entities.items() if qid != "-1"}


def get_entities_by_id(qids):
    # from a list of <= 50 QIDs, return a dict with {ID: entity_data} (functionally equal to above)
    params = {
        "action": "wbgetentities",
        "format": "json",
        "ids": "|".join(qids),
        "props": "claims"
    }
    r = requests.get(url=WD_URL, params=params, headers=HEADERS)
    data = r.json()
    return data.get("entities", {})


def get_location_properties(claims):
    # Given ONE entity's claims dict, return {prop: value} for any LOCATION_PROPS found. 
    # Coordinate values are dicts (lat/lng), entity-link values are QID strings."""
    found = {}
    for prop in LOCATION_PROPS:
        if prop in claims:
            dv = claims[prop][0].get("mainsnak",{}).get("datavalue",{})
            if dv.get("type") == "globecoordinate":
                found[prop] = {
                    "lat": dv["value"]["latitude"],
                    "lng": dv["value"]["longitude"]
                }
            elif dv.get("type") == "wikibase-entityid":
                found[prop] = dv["value"]["id"]

    return found

# because wikidata only allows 50 titles/QIDs per request, we must batch every time we want to call API
def batched(items, batch_size):
    res = []
    for i in range(0, len(items), batch_size):
        res.append(items[i:i+batch_size])
    return res

def main():
    with open("./unusual_articles.json") as f:
        titles = json.load(f)

    # from the entire list of unusual articles
    # first pass just tries to directly find coordinate info (p625)
    all_entities = {}
    for batch in batched(titles,BATCH_SIZE):
        result = get_entities_by_title(batch)
        all_entities.update(result)
        time.sleep(0.2)

    print(f"Fetched {len(all_entities)} entities from {len(titles)} titles")

    good_group = {} # qid -> {"title": ..., "coords": {lat, lng}, "source_prop": prop}
    needs_second_hop = {} # qid -> sub_qid to resolve 

    for qid, entity in all_entities.items():
        claims = entity.get("claims", {})
        title = entity.get("sitelinks", {}).get("enwiki",{}).get("title", qid)
        locations = get_location_properties(claims)

        if "P625" in locations:
            good_group[qid] = {
                "title": title,
                "coords": locations["P625"],
                "source_prop": "P625"
            }
        elif locations:
            first_prop = next(iter(locations))
            sub_qid = locations[first_prop]
            needs_second_hop[qid] = {
                "title": title,
                "sub_qid": sub_qid,
                "source_prop": first_prop
            }

    print(f"Direct coordinates: {len(good_group)}")
    print(f"Need second-hop resolution: {len(needs_second_hop)}")

    # Now we have a list of QIDs that need a second hop to resolve coordinates. 
    # We hop to the "sub qid" linked within the original article and check for coordinates there.
    # if we can't find coordinates, we fall back to NER 
    sub_qids = list({v["sub_qid"] for v in needs_second_hop.values()})
    second_hop_entities = {}

    for batch in batched(sub_qids, BATCH_SIZE):
        result = get_entities_by_id(batch)
        second_hop_entities.update(result)
        time.sleep(0.2)

    resolved_count = 0
    for qid, info in needs_second_hop.items():
        second_hop_entity = second_hop_entities.get(info["sub_qid"])
        if second_hop_entity is None:
            continue
        second_hop_entity_claims = second_hop_entity.get("claims", {})
        if "P625" in second_hop_entity_claims:
            dv = second_hop_entity_claims["P625"][0].get("mainsnak", {}).get("datavalue", {})
            coords = {
                "lat": dv["value"]["latitude"],
                "lng": dv["value"]["longitude"]
            }
            good_group[qid] = {
                "title": info["title"],
                "coords": coords,
                "source_prop": info["source_prop"], # specific location property that we rip the coordinates from
                "resolved_via": info["sub_qid"] # track the sub-article that had the coordinate information
            }
            resolved_count += 1

    print(f"Resolved via second hop: {resolved_count}")
    print(f"Total with coordinates: {len(good_group)}")

    with open("good_group.json", "w", encoding="utf-8") as f:
        json.dump(good_group, f, indent=4, ensure_ascii=False)

    still_unresolved = {
        info["title"]: info for qid, info in needs_second_hop.items()
        if qid not in good_group
    }
    with open("run_through_ner.json", "w", encoding="utf-8") as f:
        json.dump(still_unresolved, f, indent=4, ensure_ascii=False)

    print(f"Falling through to NER: {len(still_unresolved)}")


if __name__ == "__main__":
    main()