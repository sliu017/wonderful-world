import React from 'react';

export interface PinProperties {
    title: string,
    qid: string,
    blurb: string,
    image?: {
        thumbUrl: string,
        fullUrl: string,
        filePage: string,
        license: string,
        attribution: string,
        nonFree: boolean
    }
}

interface PinProps {
    pin: PinProperties,
    onClose: () => void
}
export default function Pin({pin, onClose}: PinProps) {
    const parsedImage = pin.image ? JSON.parse(pin.image as unknown as string) : null;
    return (
    <div>
        <button onClick={onClose}>x</button>
        <h3>{pin.title}</h3>
        <p>{pin.blurb}</p>
    </div>
    )
}

