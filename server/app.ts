import pool from './db'
import express from 'express'
import pinsRouter from './routes/pins'

const app = express();
app.use(express.json());

app.get('/api/ping', async (req, res) => {
    const result = await pool.query('SELECT NOW()');
    res.json({message: 'pong', time: result.rows[0].now});
});

app.use('/api/pins', pinsRouter);

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
    console.log("Server is running on port", PORT);
})