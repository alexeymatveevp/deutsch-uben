import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Update this to '/<repo-name>/' before deploying to GitHub Pages.
  base: '/your-repo/',
  plugins: [react()],
})
