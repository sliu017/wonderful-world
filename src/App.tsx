import { useState } from 'react'
import * as React from 'react'
import Map from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'

function App() {
  const [count, setCount] = useState<number>(0)

  return (
    <>
    <header className="App-header">
      <h1>MapLibre GL JS with React</h1>
    </header>
    <Map
      initialViewState={{
        longitude: -122.4,
        latitude: 37.8,
        zoom: 14
      }}
      style={{width:"1125px", height:"640px"}}
      mapStyle="https://tiles.openfreemap.org/styles/liberty"
    />
    <footer className="App-footer">
    </footer>
    </>
  )
}

export default App
