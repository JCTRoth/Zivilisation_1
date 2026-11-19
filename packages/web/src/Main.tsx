import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/design-system.css'
import './styles/index.css'
import './styles/main.css'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import ErrorBoundary from "./components/ErrorBoundary";
import { ensureTerrainFont } from "./utils/TerrainFont";

// Register the Noto Emoji Light font used for terrain symbols before the app
// mounts — the map canvas picks it up on the next frame once loaded.
void ensureTerrainFont();


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)