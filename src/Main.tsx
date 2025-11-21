import React from 'react'
import ReactDOM from 'react-dom/client'
// @ts-ignore
import App from './App.tsx'
import './styles/index.css'
import './styles/main.css'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import ErrorBoundary from "@/components/ErrorBoundary";


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)