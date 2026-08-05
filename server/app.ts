import pool from './db'
import express from 'express'

const app = express();
app.use(express.json());

app.get('/api/ping', async (req, res) => {
    const result = await pool.query('SELECT NOW()');
    res.json({message: 'pong', time: result.rows[0].now});
});