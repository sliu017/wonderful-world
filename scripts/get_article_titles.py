import json
import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Wonderful World Project/0.1 (https://github.com/sliu017)"
}
URL = "https://en.wikipedia.org/w/api.php"

PARAMS = {
    "action": "parse",
    "format": "json",
    "page": "Wikipedia:Unusual articles",
    "prop": "text",
    "pllimit": "max",
}

R = requests.get(url=URL, params=PARAMS, headers=HEADERS)
DATA = R.json()

html_content = DATA["parse"]["text"]["*"]
soup = BeautifulSoup(html_content, "html.parser")

bold_tags = soup.find_all("b")

real_articles = []
for b in bold_tags:
    link = b.find("a")
    if link and link.get("href", "").startswith("/wiki/"):
        title = link.get("title")
        if title:
            real_articles.append(title)

# dedupe while preserving order, in case a title appears bolded more than once
seen = set()
deduped = []
for title in real_articles:
    if title not in seen:
        seen.add(title)
        deduped.append(title)

print(f"Found {len(deduped)} bolded article links")

with open("unusual_articles.json", "w") as f:
    json.dump(deduped, f, indent=4)


