import './planning.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './tokens.css'
import './index.css'
import './editorial.css'
import './reader.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={<p role="status" className="loading-page">Opening the tool…</p>}><App /></React.Suspense>
  </React.StrictMode>,
)
