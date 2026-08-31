import {Router} from 'express';
import pool from '../db/db';
import {filterPins} from '../db/filter-db';

const router = Router();

// distinct categories, so the filter panel doesn't have to hardcode them
router.get('/categories', async(req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT category FROM pins ORDER BY category`
        )
        return res.status(200).json(result.rows.map((row) => row.category));
    } catch (error){
        return res.status(500).json({error: 'Error fetching categories from database.'})
    }
})

router.get('/', async(req, res) => {
    const {category} = req.query;
    try {
        if(typeof category === 'string' && category !== ''){
            const result = await filterPins('category', category, '=');
            return res.status(200).json(result.rows);
        }
        const result = await pool.query(
            `SELECT * FROM pins`
        )
        return res.status(200).json(result.rows);
    } catch (error){
        return res.status(500).json({error: 'Error fetching pins from database.'})
    }
})

export default router;
