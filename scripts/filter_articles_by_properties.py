import json
import requests

# these property tags are all at least tangentially related to location, and since we're casting a wide net, we check for them all
LOCATION_PROPS = ["P625", "P19", "P20", "P276", "P131", "P17", "P159", "P840", "P937", "P706"]

HEADERS = {
    "User-Agent": "Wonderful World Project/0.1 (https://github.com/sliu017)"
}

def get_entities_by_title(titles):
    ret = {}
    URL = "https://www.wikidata.org/w/api.php"
    joined_titles = "|".join(titles)
    PARAMS = {
        "action": "wbgetentities",
        "format": "json",
        "sites": "enwiki",
        "props": "claims",
        "titles": joined_titles  
    }
    R = requests.get(url=URL, params=PARAMS, headers=HEADERS)
    DATA = R.json()
    entities = DATA.get("entities", {})
    for entity_id, entity_data in entities.items():
        if entity_id == "-1":
            continue
        ret[entity_id] = entity_data
    return ret

# def get_location_properties(entity_json):
#     # takes ONE entity's claims json as input
#     found_properties = {}
#     needs_second_traversal = {} # dict: original ID -> sublinked ID
#     for prop in LOCATION_PROPS:
#         if(prop in entity_json.get("claims", {})):
#             dv = entity_json.get("claims", {}).get(prop, [])[0].get("mainsnak", {}).get("datavalue", {})
#             if(dv.get("type") == "globecoordinate"):
#                 # can directly store the coordinate value
#                 found_properties[prop] = dv.get("value", {})
#             elif(dv.get("type") == "wikibase-entityid"):
#                 # coordinate is nested deeper within another wikipedia article
#                 needs_second_traversal[] = dv.get("value", {}).get("id")

#     return found_properties


all_entities = {}
unusual_articles = json.load(open("unusual_articles.json"))
BATCH_SIZE = 50

for i in range(0, len(unusual_articles), BATCH_SIZE):
    batch = unusual_articles[i:i+BATCH_SIZE]
    batch_result = get_entities_by_title(batch)  # returns a dict
    all_entities.update(batch_result)

