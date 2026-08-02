import {Map, Source, Layer, Popup} from 'react-map-gl/maplibre'
import type { LayerProps, MapLayerMouseEvent } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'
import type { FeatureCollection } from 'geojson'
import geojson_data from '../scripts/data/geojson_data.json'
import React from 'react'

import Pin, {type PinProperties} from './components/Pin.tsx';


function App() {

  interface SelectedPin {
    props: PinProperties,
    lng: number,
    lat: number,
  }
  const [selectedPin, setSelectedPin] = React.useState<SelectedPin | null>(null);

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
    <Map
        initialViewState={{
          longitude: 0,
          latitude: 0,
          zoom: 2.5
        }}
        style={{width:"1125px", height:"640px"}}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
        projection={{'type': "globe"}}
        interactiveLayerIds={['point']}
        onClick = {(event) => {handleMapClick(event)}}
      >
      <Source id="geojson_data" type="geojson" data={geojson_data as FeatureCollection}>
        <Layer {...layerStyle}/>
      </Source>
      {selectedPin && 
      <>
        <Popup
          longitude={selectedPin?.lng}
          latitude={selectedPin?.lat}
          onClose = {() => setSelectedPin(null)}
          anchor="bottom"
        >
          <Pin pin={selectedPin.props} onClose={() => setSelectedPin(null)}/>
        </Popup>
      </>
      }
    </Map>


    <footer className="App-footer">
    </footer>
    </>
  )
}

export default App
