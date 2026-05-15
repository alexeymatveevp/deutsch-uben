import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import App from './App'
import LearningList from './pages/LearningList'
import CategoryList from './pages/CategoryList'
import Admin from './pages/Admin'
import AppShell from './components/AppShell'
import './index.css'

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<App />} />
          <Route path="/learning" element={<LearningList />} />
          <Route path="/learning/short" element={<Navigate to="/learning" replace />} />
          <Route path="/learning/long" element={<Navigate to="/learning" replace />} />
          <Route
            path="/expressions"
            element={
              <CategoryList
                category="ausdruck"
                title="Выражения"
                emptyText="Пока нет выражений."
              />
            }
          />
          <Route
            path="/favorites"
            element={
              <CategoryList
                category="favorite"
                title="Избранное"
                emptyText="Пока нет избранного."
              />
            }
          />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
