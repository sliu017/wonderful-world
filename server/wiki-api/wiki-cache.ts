import client, {isReady} from '../cache/redis'
import { fetchExcerpt, type WikiExcerpt } from './wiki-extract';

// Redis cache layer for our Wikipedia excerpts


const TTL = 60 * 60 * 24; // 60 seconds * 60 minutes * 24 hours = 1 day
const NEG_TTL = 60 * 60; // 1 hour for cache misses - we cache the fact that the data *doesn't* exist
const GONE = "__NOTFOUND__";

export const normalizeTitle = (title: string) =>
    title.trim().toLowerCase().replace(/ /g, '_'); 
const key = (title: string) => 
    `wiki-excerpt:en:${normalizeTitle(title)}`; 

const jitter = (base: number) => base + Math.floor(Math.random() * 3600); // spread expiries slightly

export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS' | 'RATE_LIMIT' | 'ERROR';
export async function getExcerpt(title: string){
    const k: string = key(title);

    if(!isReady()){ // redis not up and running, so just fetch the info from wikipedia
        return { data: await fetchExcerpt(title), status: 'BYPASS' as CacheStatus };

    }
    const cached: string | null = await client.get(k);
    if(cached !== null){
        return {
            data: cached === GONE ? null : JSON.parse(cached) as WikiExcerpt,
            status: "HIT" as CacheStatus
        }
    }
    const fresh: WikiExcerpt | null = await fetchExcerpt(title);
    await client.set(
        k,
        fresh === null ? GONE : JSON.stringify(fresh),
        { expiration: { type: 'EX', value: fresh === null ? NEG_TTL : jitter(TTL)}}
    )
    return { data: fresh, status: "MISS" as CacheStatus}
}

// uses MGET to determine which articles we actually need to send an api call to retrieve
export async function readMissingTitles(titles: string[]): Promise<string[]>{
    if(titles.length === 0){ 
        return [];
    }
    const cached = await client.mGet(titles.map(key));
    return titles.filter
        ((_, i) => cached[i] === null);
}

export async function writeExcerpts(entries: Map<string, WikiExcerpt | null>): Promise<void>{
    if(entries.size === 0){
        return;
    }
    const multi = client.multi();
    for (const [title, excerpt] of entries){
        multi.set(
            key(title),
            excerpt === null ? GONE : JSON.stringify(excerpt),
            {
                expiration: { type: 'EX', value: excerpt === null ? NEG_TTL : jitter(TTL)},
                condition: 'NX' // not existent - can only add, not overwrite 
            }
        )
    }
    await multi.exec();
}