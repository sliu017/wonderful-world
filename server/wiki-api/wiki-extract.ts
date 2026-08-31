import { wikiBucket, RateLimitError } from '../cache/rate-limiter';

const WP_URL = "https://en.wikipedia.org/api/rest_v1/page/summary";

// Data we get from Wikipedia to be served (will end up being the first paragraph under the blurb)

export interface WikiExcerpt {
    title: string;
    excerpt: string;
    articleUrl: string;
}

export async function fetchExcerpt(title: string): Promise<WikiExcerpt | null> {
    if(!wikiBucket.consumeToken()){
        throw new RateLimitError(title);
    }
    const slug = encodeURIComponent(title.replace(/ /g, '_'));
    const res = await fetch(`${WP_URL}/${slug}`, {
        headers: {
            "User-Agent": "Wonderful World Project/0.1 (https://github.com/sliu017)",
        },
        "signal": AbortSignal.timeout(5000)
        
    });
    if(res.status === 404){
        return null; // article doesn't exist
    }
    if(!res.ok){
        throw new Error(`Failed to fetch Wikipedia excerpt for ${title}: ${res.status}`)
    }
    const data = await res.json();

    // only "standard" pages carry a real excerpt - disambig pages for example will just return a bunch of empty chars
    // in theory we will only be calling on standard pages, but... 
    if(data.type && data.type !== "standard"){
        return null;
    }

    return {
        title: data.titles?.normalized ?? title,
        excerpt: data.extract ?? "",
        articleUrl: data.content_urls?.desktop?.page ?? "",
    }

}
