import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n/index.tsx'
import { ThemeProvider } from './contexts/ThemeContext.tsx'

// Apply initial theme synchronously before first paint to avoid flash
const _t = (() => { try { return localStorage.getItem('qafone-theme') || 'dark'; } catch { return 'dark'; } })();
if (_t === 'dark' || (_t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
  document.documentElement.classList.add('dark');
} else {
  document.documentElement.classList.remove('dark');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)


