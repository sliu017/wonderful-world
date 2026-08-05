# Goal is to turn reviews.json (at the time of executing the file) into a geojson, suitable for
# displaying on a map through a pin

import json

with open("../manual-review/reviews.json", "r") as f:
    data = json.load(f)

# with open("./data/group_with_direct_coords.json", "r") as f:
#     direct_coords_data = json.load(f)

## TODO: Not currently working, need to fix data shape
geojson_data = {}
geojson_data["type"] = "FeatureCollection"
geojson_data["features"] = []
for key, value in data.items():
    if(value["status"] == "skipped"):
        continue

    data_category = key.split(":")[0] # Might need later? "good", "ner"
    id = key.split(":")[1]
    
    this_item = {                     
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [value["lng"], value["lat"]],
        },
        "properties": {
            "title": value["title"],
            "qid": id,
            "category": value.get("category", ""),
            "blurb": value["blurb"],
            "image": { "thumbUrl": value["image"]["thumbUrl"], 
                       "fullUrl": value["image"]["fullUrl"],
                        "filePage": value["image"]["filePage"],
                        "license": value["image"]["license"],
                        "attribution": value["image"]["attribution"],
                        "nonFree": value["image"]["nonFree"]}
                        if value["image"] else None
        },
    }
    geojson_data["features"].append(this_item)
    

with open("./data/geojson_data.json", "w") as f:
    json.dump(geojson_data, f, indent=4)

