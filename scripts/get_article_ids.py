# Get information about the Jupiter article on English Wikipedia
import requests

url = 'https://en.wikipedia.org/w/rest.php/v1/page/Jupiter/bare'
headers = {
    'User-Agent': 'MediaWiki REST API docs examples/0.1 (https://www.mediawiki.org/wiki/API_talk:REST_API)'
}


response = requests.get(url, headers=headers)
data = response.json()

print(data)