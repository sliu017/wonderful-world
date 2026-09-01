/* Architecture notes:
Throughout the codebase, there are multiple instances where we call the Wikipedia API to fetch extracts, from the naive 
call upon clicking a pin to the predictive prefetching.

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

const BUCKET_CAP = 180; // small leeway around wikipedia's enforced 200/min limit
const REFILL_RATE_PER_SECOND = 3;

export const RESERVE_FOR_DIRECT_REQUESTS = 30; // Allow some leeway for requests from pin clicks, 
// e.g. the prefetch will not use up these tokens

export class RateLimitError extends Error {
    constructor(title?: string){
        super(`Wikipedia API limit exceeded${title ? ` for ${title}`: ''}`);
        this.name = 'RateLimitError';
    }
}
class TokenBucket {
    private tokens = BUCKET_CAP;
    private lastRefillTime = performance.now();

    // Runs on every call, successful or not
    private refill(): void {
        const now = performance.now();
        const elapsedSeconds = (now - this.lastRefillTime) / 1000;
        this.tokens = Math.min(BUCKET_CAP, this.tokens + elapsedSeconds * REFILL_RATE_PER_SECOND);
        this.lastRefillTime = now;
    }

    public consumeToken(minTokensRemaining: number = 0): boolean { // where the amount represents the 
        // number of tokens left in reserve for this call to go through, reflecting the tokens we leave in reserve
        // to ensure direct calls always go through.
        this.refill();
        if(this.tokens >= 1 + minTokensRemaining) {
            this.tokens--;
            return true;
        } else {
            return false;
        }
    }

}

export const wikiBucket = new TokenBucket();
