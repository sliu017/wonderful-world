import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();
const client = createClient({
    url: process.env.REDIS_URL,
    socket: {
        connectTimeout: 2000,
        // need to a set a limit because default behavior is to retry forever 
        reconnectStrategy: (retries) =>
            retries >= 3
                ? new Error('gave up connecting to redis')
                : Math.min((retries + 1) * 200, 1000),
    },
})

client.on('error', (err) => console.error('[redis]', err.message));

client.connect()
    .then(() => console.log('[redis] Redis client connected!'))
    .catch((err) => console.error('[redis] Redis client connection error. Serving uncached data.', err.message));

// export as a function so we capture its changing state
export const isReady = () => client.isReady;
export default client;
