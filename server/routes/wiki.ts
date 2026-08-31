import { Router } from 'express';
import { getExcerpt } from '../wiki-api/wiki-cache';
import { RateLimitError } from '../cache/rate-limiter'

const router = Router();

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