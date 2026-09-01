import { Router } from 'express';
import { getExcerpt } from '../wiki-api/wiki-cache';
import { prefetchExcerpts } from '../wiki-api/wiki-prefetch';
import { RateLimitError } from '../cache/rate-limiter'

const router = Router();


const MAX_TITLES_PER_REQUEST = 3000; // soft limit
// exists because before we limit deeper into the lifecycle, we call readMissingTitles() on the list,
// which is a Redis MGET - an absurdly large list of titles (more than Wikipedia can even send back)
// will cause the server to slow down significantly. thus, we limit to only requests "within the limits"

router.post('/prefetch', (req, res) => {
    const body = req.body as { titles?: unknown };
    if(!Array.isArray(body?.titles)){
        return res.status(400).json({ error: 'expected { titles: string[] }' });
    }
    const titles = body.titles
        .filter((t): t is string => typeof t === 'string') 
        // typeof filters non-strings at runtime
        // typescript then treats the resulting filtered array as string[] because of our type predicate note 
        .slice(0, MAX_TITLES_PER_REQUEST);
    void prefetchExcerpts(titles).catch((err) => console.error('[wiki] prefetch', err));
    return res.status(202).end(); // still processing, use 202
});

router.get('/:title', async (req,res) => {
    try {
        // gets excerpt-shaped data from /wiki-cache (see interface there)
        const { data, status } = await getExcerpt(req.params.title);
        res.set('X-Cache-Status', status);

        if(!data){
            // neither an error nor a fatal result to have no excerpt - could arise from article not existing, being
            // disambiguation, or some other reason. but we just don't serve the excerpt and it's no biggie
            return res.json({ excerpt: null})
        }

        return res.json({
            title: data.title,
            excerpt: data.excerpt,
            articleUrl: data.articleUrl
        });
    } catch (err) {
        // not a fatal error, just noting that we reached rate limits
        if(err instanceof RateLimitError){
            console.warn('[wiki]', err.message);
            res.set('X-Cache-Status', 'RATE_LIMIT');
            return res.json({
                excerpt: null
            })
        }
        console.error('[wiki]', err);
        res.set('X-Cache-Status', 'ERROR');
        return res.json({
            excerpt: null
        })
    }
})

export default router;