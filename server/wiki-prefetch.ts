/*
Architecture notes:

Issue: Users who open pins will have to wait 250ms on first load, before the results are cached. Therefore,
we want to prefetch some results so that this wait time is eliminated.

We use the viewport the user is currently looking at, capping at a certain number of pins to ensure we don't immediately
reach rate limits - this means that at first load on the zoomed out world map this will certainly instantly reach the cap.
TODO: This is an issue we can resolve by limiting to certain zoom levels 

How do we ensure we don't reach rate limits (200/min for Wikipedia)? We use a global token bucket that starts at 180 requests
(a little lower than 200 to have some wiggle room), then refill it upon each request INSTEAD of a global variable that operates
on a timer --- this can often be wasted work and lose levels of precision (among other issues). 

This is implemented through a lazy refill system where each call to API-reaching methods checks the time elapsed since last
call then adds 3 * (second differential), reflecting the rate of 3 tokens per second (180 / minute).

Note that when the bucket is empty, e.g. we don't have any requests left in the current window, new requests
will be DROPPED, not enqueued. This is due to the predicted low time spent per request - users will most likely be clicking
through pins quickly and we don't need to wait to serve up content they have already passed over. 

Write this through a separate consumeToken() function that is reached by all API-reaching methods. 
Always refill on method calls, use floating-point operations due to the possibility of millisecond-level differences. 
*/

import { WikiExcerpt, fetchExcerpt } from './wiki-extract';

const BUCKET_CAP = 180; // small leeway around wikipedia's enforced 200/min limit
const REFILL_RATE_PER_SECOND = 3;

class TokenBucket {
    private tokens = BUCKET_CAP;
    private lastRefillTime = Date.now();

    // Runs on every call, successful or not
    private refill(): void {
        const now = Date.now();
        const elapsedSeconds = (now - this.lastRefillTime) / 1000;
        this.tokens = Math.min(BUCKET_CAP, this.tokens + elapsedSeconds * REFILL_RATE_PER_SECOND);
        this.lastRefillTime = now;
    }

    public consumeToken(): boolean {
        this.refill();
        if(this.tokens >= 1) {
            this.tokens--;
            return true;
        } else {
            return false;
        }
    }

}

const wikiBucket = new TokenBucket();

function buildArticleUrl(title: string): string {
    const slug = encodeURIComponent(title.replace(/ /g, '_'));
    return `https://en.wikipedia.org/wiki/${slug}`;
}

async function callWikipediaExtracts(titles: string[]): Promise<Map<string, WikiExcerpt>> {
    // params required to batch fetch - as opposed to the easier single fetch within wiki-extract.ts
    const params = new URLSearchParams({
        action: 'query',
        prop: 'extracts',
        exintro: 'true',
        explaintext: 'true',
        format: 'json',
        titles: titles.join('|')
    })
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
        headers: {
            'User-Agent': 'Wonderful World Project/0.1 (https://github.com/sliu017)',
        },
        signal: AbortSignal.timeout(5000)
    });

    if(!res.ok){
        throw new Error(`Failed to fetch Wikipedia excerpts: ${res.status}`);
    }
    const data = await res.json();
    const resultMap = new Map<string, WikiExcerpt>();
    const pages = data?.query?.pages ?? {};

    for(const page of Object.values<any>(pages)){
        if(!page.title || typeof page.extract !== 'string'){
            continue;
        }
        if(page.extract.length === 0){
            continue;
        }
        resultMap.set(page.title, {
            title: page.title,
            excerpt: page.extract,
            articleUrl: buildArticleUrl(page.title)
        });
    }

    return resultMap;

}

export async function fetchExtractsBatch(titles: string[]): Promise<Map<string, WikiExcerpt>> {
    if(titles.length === 0){
        return new Map();
    }
    if(titles.length > 20){
        throw new Error(`fetchExtractsBatch called with ${titles.length} titles, which exceeds the maximum of 20`)
    }
    if(!wikiBucket.consumeToken()){
        return new Map();
    }

    return callWikipediaExtracts(titles);
}
