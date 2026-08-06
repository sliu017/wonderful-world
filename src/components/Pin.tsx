import React from 'react';
import './Pin.css';

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

interface PinProps {
    pin: PinProperties,
    onClose: () => void,
    /** card width in px, driven by map zoom; falls back to the CSS default */
    width?: number
}

function parseImage(image: PinProperties['image']): PinImage | null {
    if (!image) return null;
    if (typeof image !== 'string') return image;
    try {
        return JSON.parse(image) as PinImage;
    } catch {
        return null;
    }
}

export default function Pin({pin, onClose, width}: PinProps) {
    const image = parseImage(pin.image);
    const credit = [image?.attribution, image?.license].filter(Boolean).join(' · ');

    // keeps the card in the keyboard tab order without the browser scrolling
    const cardRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        cardRef.current?.focus({preventScroll: true});
    }, [pin.qid]);

    return (
    <div
        className="pin"
        ref={cardRef}
        tabIndex={-1}
        style={width ? ({'--pin-w': `${width}px`} as React.CSSProperties) : undefined}
    >
        <button className="pin__close" onClick={onClose} aria-label={`Close ${pin.title}`}>
            <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
        </button>

        {image?.thumbUrl &&
            <figure className="pin__media">
                <img src={image.thumbUrl} alt={pin.title} loading="lazy" />
                {credit &&
                    <figcaption className="pin__credit">
                        {image.filePage
                            ? <a href={image.filePage} target="_blank" rel="noreferrer">{credit}</a>
                            : credit}
                    </figcaption>
                }
            </figure>
        }

        <div className="pin__body">
            <h3 className="pin__title">
                <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(pin.title)}`}
                   target="_blank" 
                    // good protection against tabnabbing
                   rel="noopener noreferrer" 
                //    style={{textDecoration:"underline"}}
                >
                    {pin.title} 
                </a> 
            </h3>
            <p className="pin__blurb">{pin.blurb}</p>
        </div>
    </div>
    )
}
