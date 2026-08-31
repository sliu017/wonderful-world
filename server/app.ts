import pool from './db/db'
import './cache/redis'
import express from 'express'
import pinsRouter from './routes/pins'
import wikiRouter from './routes/wiki'

const app = express();
app.use(express.json());
console.log('[server] Express server initialized!');

app.get('/api/ping', async (req, res) => {
    const result = await pool.query('SELECT NOW()');
    res.json({message: 'pong', time: result.rows[0].now});
});

app.use('/api/pins', pinsRouter);
app.use('/api/wiki', wikiRouter);

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
    console.log("Server is running on port", PORT);
})