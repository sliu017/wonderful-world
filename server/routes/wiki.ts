import { Router } from 'express';
import { getExcerpt } from '../wiki-cache';

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
            description: data.description,
            excerpt: data.excerpt,
            excerptHtml: data.excerptHtml,
            articleUrl: data.articleUrl
        });
    } catch (err) {
        console.error('[wiki]', err);
        res.set('X-Cache-Status', 'ERROR');
        return res.json({
            excerpt: null
        })
    }
})

export default router;