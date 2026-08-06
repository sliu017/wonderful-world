// Seed database with existing articles
// Pulled from ./scripts/data/geojson_data.json
// (Might wanna clean up the file structure a little)

import pool from './db';
import data from '../scripts/data/geojson_data.json';
// import type PinProperties from '../src/components/Pin.tsx'

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


async function seedDatabase(){
    for (const pin of data.features) {
            const {qid, title, blurb, category} = pin.properties;
            const[lng, lat] = pin.geometry.coordinates;
            if(!title || !category || !lat || !lng) {
                console.error(`Missing some required field(s) for pin with qid: ${qid} and title: ${title}`);
                continue;
            }
            // NOTE: Line below can break depending on what categories are currently in the data
            let media;
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
}