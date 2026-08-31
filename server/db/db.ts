import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
})
pool.on('error', (err) => console.error('[postgres]', err.message));

export default pool