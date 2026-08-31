// test-connection.ts
import pool from './db/db'

pool.query('SELECT NOW()')
  .then((res) => {
    console.log('Connected! Server time:', res.rows[0])
    process.exit(0)
  })
  .catch((err) => {
    console.error('Connection failed:', err)
    process.exit(1)
  })