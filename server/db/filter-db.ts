// server-side filtering to practice building postgres queries instead of just writing it all in js :)

import pool from './db';
import type { QueryResult } from 'pg';

const ALLOWED_FILTER_PROPERTIES = ['category', 'title', 'lat', 'lng'] // ['media'] <-- lat/lng require more complex queries
// can add more later, although category will be used most in practice
// this is just to prevent sql injection since property is used directly in the query

// Again, directly from '../../src/components/Pin.tsx' 
export interface PinImage {
    thumbUrl: string,
    fullUrl: string,
    filePage: string,
    license: string,
    attribution: string,
    nonFree: boolean
}

interface PinRow {
    internal_article_id: number,
    qid: string | null,
    title: string,
    blurb: string | null,
    category: string,
    lat: string,
    lng: string,
    media: PinImage | null, // TODO add more media types here
}

export async function filterPins(property: string, value: string, comparator: string): Promise<QueryResult<PinRow>> {
    if(!ALLOWED_FILTER_PROPERTIES.includes(property)){
        throw new Error(`Filtering by property ${property} is not allowed.`);
    } else {
        if(property === 'lat' || property == 'lng'){
            if(comparator !== '=' && comparator !== '>' && comparator !== '<'){
                throw new Error(`Invalid comparator ${comparator} for property ${property}! Only '=', '>', and '<' are accepted`);
            } else {
                return pool.query(`SELECT * FROM pins WHERE ${property} ${comparator} $1`, [value])
            }
        } else {
            if(comparator !== '='){
                throw new Error(`Invalid comparator ${comparator} for property ${property} - should be '='!`);
            } else {
                return pool.query(`SELECT * FROM pins WHERE ${property} = $1`, [value])
            }
        }
    }
}