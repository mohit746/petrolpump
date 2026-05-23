import './i18n'
import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-orange-50">
        <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <App />
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: { borderRadius: '12px', fontSize: '14px', maxWidth: '340px' },
          success: { style: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' } },
          error: { style: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' } },
        }}
      />
    </Suspense>
  </React.StrictMode>,
)