/*
Architecture notes:

Issue: Users who open pins will have to wait 250ms on first load, before the results are cached. Therefore,
we want to prefetch some results so that this wait time is eliminated.

We use the viewport the user is currently looking at, capping at a certain number of pins to ensure we don't immediately
reach rate limits - this means that at first load on the zoomed out world map this will certainly instantly reach the cap.
TODO: This is an issue we can resolve by limiting to certain zoom levels 

Note: currently moving rate limiting logic to its own file due to its shared nature 
*/

import { WikiExcerpt, } from './wiki-extract';
import { wikiBucket, RESERVE_FOR_DIRECT_REQUESTS } from '../cache/rate-limiter';
import { resumeToPipeableStream } from 'react-dom/server';

function buildArticleUrl(title: string): string {
    const slug = encodeURIComponent(title.replace(/ /g, '_'));
    return `https://en.wikipedia.org/wiki/${slug}`;
}

async function callWikipediaExtracts(titles: string[]): Promise<Map<string, WikiExcerpt | null>> {
    // params required to batch fetch - as opposed to the easier single fetch within wiki-extract.ts
    const params = new URLSearchParams({
        action: 'query',
        prop: 'extracts|pageprops',
        ppprop: 'disambiguation', // disambig pages kinda mess everything up, so make sure we're aware of the page being one
        exintro: 'true', // just get the introductory section of the article
        explaintext: 'true', // ex plaintext [as opposed to html], not "explain text" 
        redirects: '1',
        format: 'json',
        formatversion: '2',
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
    const resultMap = new Map<string, WikiExcerpt | null>();
    const pages = data?.query?.pages ?? [];

    for(const page of Object.values<any>(pages)){
        if(!page.title){
            continue;
        }
        if(page.missing === true || page.pageprops?.disambiguation !== undefined){
            // set a cache miss if the page doesn't exist or is a disambiguation page
            resultMap.set(page.title, null);
            continue;
        }
        if(typeof page.extract !== 'string' || page.extract.length === 0){
            continue;
        }
        resultMap.set(page.title, {
            title: page.title,
            excerpt: page.extract,
            articleUrl: buildArticleUrl(page.title)
        });
    }

    /*
    future-proof the caching mechanism a little bit with the awareness that Wikipedia is constantly changing.
    therefore, there may be an article change such that the article title at review time is no longer the same 
    as the current title. this caches the new article title under the old one, so that requests looking for the old
    title still find the desired article

    we need only examine redirects as "case" changes are already handled by normalization

    the more robust solution would be to canocalize the titles at seed time - TODO? 
    */
    for(const {from, to} of (data?.query?.redirects ?? [])){
        if(resultMap.has(to)){
            resultMap.set(from, resultMap.get(to)!);
            console.warn(`[prefetch] '${from}' now redirects to '${to}' - update the DB.`);
        }
    }

    return resultMap;

}

export async function fetchExtractsBatch(titles: string[]): Promise<Map<string, WikiExcerpt | null>> {
    if(titles.length === 0){
        return new Map();
    }
    if(titles.length > 20){
        throw new Error(`fetchExtractsBatch called with ${titles.length} titles, which exceeds the maximum of 20`)
    }
    if(!wikiBucket.consumeToken(RESERVE_FOR_DIRECT_REQUESTS)){
        return new Map();
    }

    return callWikipediaExtracts(titles);
}
