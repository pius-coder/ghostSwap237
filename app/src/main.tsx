import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import './index.css'
import '@/i18n'
import App from './App.tsx'
import { normalizeWebAuthCallbackLocation } from '@/lib/auth'

normalizeWebAuthCallbackLocation()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
