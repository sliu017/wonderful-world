import {Router} from 'express';
import pool from '../db';

const router = Router();

router.get('/', async(req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM pins`
        )
        return res.status(200).json(result.rows);
    } catch (error){
        return res.status(500).json({error: 'Error fetching pins from database.'})
    }
})

export default router;
