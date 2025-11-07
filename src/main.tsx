import React from 'react'
import ReactDOM from 'react-dom/client'
import ErrorBoundary from './components/ErrorBoundary.jsx'
//import App from './App.jsx'
//import SimpleGameApp from './SimpleGameApp.jsx'
import Civ1App from './Civ1App.jsx'
//import MinimalApp from './components/MinimalApp.jsx'
//import VerySimple from './VerySimple.jsx'
//import SimpleApp from './SimpleApp.jsx'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './styles/index.css'
import './styles/main.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Civ1App />
    </ErrorBoundary>
  </React.StrictMode>,
)