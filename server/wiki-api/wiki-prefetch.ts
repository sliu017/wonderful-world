/*
Architecture notes:

Issue: Users who open pins will have to wait 250ms on first load, before the results are cached. Therefore,
we want to prefetch some results so that this wait time is eliminated.

We use the viewport the user is currently looking at, capping at a certain number of pins to ensure we don't immediately
reach rate limits - this means that at first load on the zoomed out world map this will certainly instantly reach the cap.
TODO: This is an issue we can resolve by limiting to certain zoom levels 

*/

import { WikiExcerpt, } from './wiki-extract';
import { wikiBucket, RESERVE_FOR_DIRECT_REQUESTS } from '../cache/rate-limiter';
import { isReady } from '../cache/redis';
import { readMissingTitles, writeExcerpts, normalizeTitle } from './wiki-cache';

function buildArticleUrl(title: string): string {
    const slug = encodeURIComponent(title.replace(/ /g, '_'));
    return `https://en.wikipedia.org/wiki/${slug}`;
}

async function fetchExcerpts(titles: string[]): Promise<Map<string, WikiExcerpt | null>> {
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
        if(typeof page.extract !== 'string'){
            continue;
        }
        if(page.extract.length === 0){
            resultMap.set(page.title, null); // if the page just has no extract
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

/*
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

    return fetchExcerpts(titles);
}
*/

const MAX_TITLES_PER_CALL = 20;
const inFlight = new Set<string>();

function chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for(let i = 0; i < arr.length; i += size){
        chunks.push(arr.slice(i, i+size));
    }
    return chunks;
}
export async function prefetchExcerpts(titles: string[]): Promise<void>{
    if(!isReady()){
        return;
    }
    const seen = new Set<string>();
    const titlesToFind = titles.filter((t) => {
        if(t.trim().length === 0 || t.includes("|")){ // we use | as our delimiter so make sure to exclude titles with it
                                                      // (luckily, it's a banned character in Wikipedia titles)
            return false;
        }
        const normedTitle = normalizeTitle(t);
        if(seen.has(normedTitle) || inFlight.has(normedTitle)){
            return false;
        }
        seen.add(normedTitle);
        return true;
    })
    // const titlesToFind = [...new Set(titles)] // deduplicate 
    //     .filter((t) => t.trim().length > 0 && !t.includes("|") && !inFlight.has(t));
    // if(titlesToFind.length === 0){
    //     return;
    // }
    titlesToFind.forEach((t: string) => inFlight.add(normalizeTitle(t)));
    try {
        const misses = await readMissingTitles(titlesToFind);
        for(const batch of chunk(misses, MAX_TITLES_PER_CALL)){
            if(!wikiBucket.consumeToken(RESERVE_FOR_DIRECT_REQUESTS)){
                console.warn("[prefetch] rate limit reached. skipping batch of titles:", batch);
                return; 
            }
            try {
                await writeExcerpts(await fetchExcerpts(batch));
            } catch(err){
                console.error("[prefetch] failed to fetch excerpts for batch of titles:", batch, err);
            } 
        }
    } catch(err) {
        console.error("[prefetch] cache lookup failed:" ,err);
        return;
    } finally {
        titlesToFind.forEach((t: string) => inFlight.delete(normalizeTitle(t)));
    }
    // try {
    //     misses = await readMissingTitles(titlesToFind);
    // } catch(err) {
    //     console.error("[prefetch] cache lookup failed:" ,err);
    //     return;
    // }


}
