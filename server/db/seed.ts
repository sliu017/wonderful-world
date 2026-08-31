// Seed database with existing articles
// Pulled from ./scripts/data/geojson_data.json
// (Might wanna clean up the file structure a little)

// Must be run within /server due to .env 
// npx tsx db/seed.ts 

import pool from './db';
import type { FeatureCollection, Point} from 'geojson';
import geojsonData from '../../scripts/data/geojson_data.json'
import {createInterface} from 'node:readline/promises';
// import type PinProperties from '../../src/components/Pin.tsx'

const data = geojsonData as FeatureCollection<Point, PinProperties>;

// taken from ../src/components/Pin.tsx, consider merging into some shared folder/file
export interface PinImage {
    thumbUrl: string,
    fullUrl: string,
    filePage: string,
    license: string,
    attribution: string,
    nonFree: boolean
}

export interface PinProperties {
    title: string,
    qid: string,
    blurb: string,
    category: string,
    image?: PinImage
    // Add more media types as we go
}

async function confirm(question: string): Promise<boolean> {
    const rl = createInterface({ //readline interface
        input: process.stdin,
        output: process.stdout
    })
    const response = await rl.question(`${question} (y/n): `)
    rl.close()
    return response.trim().toLowerCase() === 'y'
}

async function seedDatabase(): Promise<void>{
    // Ask for confirmation because this is a destructive action
    const confirmed: boolean = await(confirm("Are you sure you want to reseed the database? Doing so will delete all existing data in pins."))
    // First truncate data, since we're reseeding the database by running this
    if(confirmed){
        try {
            await pool.query('TRUNCATE TABLE pins RESTART IDENTITY;');
        } catch (error) {
            console.error("Error truncating pins table: ", error);
        }
        for (const pin of data.features) {
                const {qid, title, blurb, category} = pin.properties;
                const[lng, lat] = pin.geometry.coordinates;
                if(!title || !category || lat == null || lng == null) {
                    console.error(`Missing some required field(s) for pin with qid: ${qid} and title: ${title}`);
                    continue;
                }
                // NOTE: Line below can break depending on what categories are currently in the data
                let media: PinImage | undefined; // TODO Define other media shapes later
                if(category != 'gsv'){
                    media = pin.properties.image;
                }
            try {
                await pool.query(
                    'INSERT INTO pins (qid, title, blurb, category, lat, lng, media) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                    [qid, title, blurb, category, lat, lng, media]
                )
            } catch (error) {
                console.error(`Error inserting pin with qid: ${qid} and title: ${title}`, error);
            }
        }
    } else {
        console.log("Seeding canceled - no changes made.")
        process.exit(0);
    }
}

seedDatabase().then(() => {
    console.log("Seeding database complete!");
    process.exit(0);
}).catch((error) => {
    console.log("Error seeding database: ", error);
    process.exit(1);
});
