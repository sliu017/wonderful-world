import {Map, Source, Layer} from 'react-map-gl/maplibre'
import type { LayerProps } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'
import type { FeatureCollection } from 'geojson'
import geojson_data from '../scripts/data/geojson_data.json'


function App() {

// essentially a test layer, but good for poc
  const layerStyle: LayerProps = {
    id: "point",
    type: "circle" as const,
    paint: {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        2, 2,
        10, 8
      ],
      "circle-color": "#007cbf"
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
        zoom: 2
      }}
      style={{width:"1125px", height:"640px"}}
      mapStyle="https://tiles.openfreemap.org/styles/liberty"
      projection={{'type': "globe"}}
      >
      <Source id="geojson_data" type="geojson" data={geojson_data as FeatureCollection}>
        <Layer {...layerStyle}/>
      </Source>
    </Map>
    <footer className="App-footer">
    </footer>
    </>
  )
}

export default App
