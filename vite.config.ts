import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Accept "/deutsch-uben", "deutsch-uben", or "" — normalize to "/<name>/" or "/".
  const raw = env.VITE_BASE_PATH?.trim().replace(/^\/|\/$/g, '') ?? ''
  const base = raw ? `/${raw}/` : '/'

  return {
    base,
    server: {
      host: true,
      proxy: {
        '/api': 'http://localhost:3001',
      },
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectRegister: 'auto',
        includeAssets: ['vite.svg'],
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        },
        manifest: {
          name: 'Deutsch Uben',
          short_name: 'Deutsch',
          description: 'Flashcards for language training',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          start_url: base,
          scope: base,
          icons: [
            {
              src: 'icons/app-icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ],
        },
      }),
    ],
  }
})
