import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import App from './App'
import LearningList from './pages/LearningList'
import AppShell from './components/AppShell'
import './index.css'

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<App />} />
          <Route path="/learning/short" element={<LearningList status="short" />} />
          <Route path="/learning/long" element={<LearningList status="long" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
