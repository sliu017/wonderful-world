import {Map, Source, Layer, Popup} from 'react-map-gl/maplibre'
import type { LayerProps, MapLayerMouseEvent } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'
import type { FeatureCollection, Point } from 'geojson'
import React from 'react'

import Pin, {type PinProperties, type PinImage} from './components/Pin.tsx';
import FilterPanel from './components/FilterPanel.tsx';


const INITIAL_ZOOM = 2.5;

// Equivalent to the PinRow interface from ../server/filter-db.ts
// This is the type we receive by passing through this method, representing the post-filtered rows 
interface PinRow {
  qid: string,
  title: string,
  blurb: string,
  category: string,
  lat: string,
  lng: string,
  media: PinImage | null
}

const EMPTY_PINS: FeatureCollection<Point, PinProperties> = {type: 'FeatureCollection', features: []};

// kind of an annoying consequence of server-side filtering, but it's cool
// need geojson formatted data source for the map, so have to convert filtered rows
function rowsToGeojson(rows: PinRow[]): FeatureCollection<Point, PinProperties> {
  return {
    type: 'FeatureCollection',
    features: rows.map((row) => ({
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [Number(row.lng), Number(row.lat)]},
      properties: {
        title: row.title,
        qid: row.qid,
        blurb: row.blurb,
        category: row.category,
        image: row.media ?? undefined
      }
    }))
  }
}

function App() {

  interface SelectedPin {
    props: PinProperties,
    lng: number,
    lat: number,
  }
  const [selectedPin, setSelectedPin] = React.useState<SelectedPin | null>(null);
  const [zoom, setZoom] = React.useState(INITIAL_ZOOM);
  const [categories, setCategories] = React.useState<string[]>([]);
  const [category, setCategory] = React.useState<string | null>(null);
  const [pins, setPins] = React.useState(EMPTY_PINS);

  React.useEffect(() => {
    fetch('/api/pins/categories')
      .then((res) => res.json())
      .then(setCategories)
      .catch((error) => 
        console.error("Couldn't load categories: ", error));
  }, []);

  
  React.useEffect(() => {
    const query = category ? `?category=${encodeURIComponent(category)}` : '';

    fetch(`/api/pins${query}`)
      .then((res) => res.json())
      .then((rows: PinRow[]) => setPins(rowsToGeojson(rows)))
      .catch((error) =>
        console.error("Couldn't load pins: ", error));
    setSelectedPin(null);
  }, [category]);

  // allows for popup to scale with zoom, uses a slope formula to determine max 
  const popupWidth = Math.round(
    Math.min(280, Math.max(280, 380 - (zoom - 2) * 10))
  );

  const layerStyle: LayerProps = {
    id: "point",
    type: "circle" as const,
    paint: {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        2, 2,
        10, 9
      ],
      "circle-color": "#007cbf"
    }
  } 

  function handleMapClick(event: MapLayerMouseEvent){
    const features = event.features;
    if(features && features.length > 0){
      const feature = features[0];
      const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates as [number, number]
      console.log("clicked feature properties: ", feature.properties);
      setSelectedPin({
        props: features[0].properties as PinProperties,
        lng: lng,
        lat: lat
      })
    } else {
      setSelectedPin(null);
    }
  }

  return (
    <>
    <header className="App-header">
      <h1>MapLibre GL JS with React</h1>
    </header>
    <FilterPanel
      categories={categories}
      selectedCategory={category}
      onSelect={setCategory}
      count={pins.features.length}
    />
    <Map
        initialViewState={{
          longitude: 0,
          latitude: 0,
          zoom: INITIAL_ZOOM
        }}
        style={{width:"1125px", height:"640px"}}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
        projection={{'type': "globe"}}
        interactiveLayerIds={['point']}
        onClick = {(event) => {handleMapClick(event)}}
        // quantised so a continuous pinch/wheel gesture only re-renders in steps
        onZoom = {(event) => setZoom(Math.round(event.viewState.zoom * 4) / 4)}
      >
      <Source id="geojson_data" type="geojson" data={pins}>
        <Layer {...layerStyle}/>
      </Source>
      {selectedPin &&
        <Popup
          longitude={selectedPin.lng}
          latitude={selectedPin.lat}
          onClose = {() => setSelectedPin(null)}
          anchor="bottom"
          className="pin-popup"
          closeButton={false} // we will create a custom close button
          maxWidth="none"
          // prevent jarring scroll jump when a pin is selected
          focusAfterOpen={false}
        >
          <Pin pin={selectedPin.props} width={popupWidth} onClose={() => setSelectedPin(null)}/>
        </Popup>
      }
    </Map>


    <footer className="App-footer">
    </footer>
    </>
  )
}

export default App
