import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'PumpManager — पंप मैनेजर',
        short_name: 'PumpManager',
        description: 'Petrol Pump Employee Management',
        theme_color: '#ea580c',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'supabase-cache', expiration: { maxAgeSeconds: 300 } },
          },
        ],
      },
    }),
  ],
  server: { port: 3001, host: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase': ['@supabase/supabase-js'],
          'i18n': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          'utils': ['date-fns', 'zustand', 'react-hook-form', 'react-hot-toast'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
})
