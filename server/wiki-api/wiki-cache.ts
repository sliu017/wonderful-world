import client, {isReady} from '../cache/redis'
import { fetchExcerpt, type WikiExcerpt } from './wiki-extract';

// Redis cache layer for our Wikipedia excerpts


const TTL = 60 * 60 * 24; // 60 seconds * 60 minutes * 24 hours = 1 day
const NEG_TTL = 60 * 60; // 1 hour for cache misses - we cache the fact that the data *doesn't* exist
const GONE = "__NOTFOUND__";

const key = (title: string) => 
    `wiki-excerpt:en:${title.trim().toLowerCase().replace(/ /g, '_')}`; // normalize all titles by lowercasing and spaces -> underscores

const jitter = (base: number) => base + Math.floor(Math.random() * 3600); // spread expiries slightly

export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS'
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

// // uses MGET functionality 
// export async function findUncached(titles: string[]): Promise<string[]>{
//     if(titles.length === 0){ 
//         return [];
//     }

// }