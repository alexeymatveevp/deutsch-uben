import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Netlify serves from the site root by default.
  base: '/',
  plugins: [react()],
})
