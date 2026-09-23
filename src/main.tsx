import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { createDesktopApi } from './lib/desktop-api'
import { initializeAppearance } from './lib/appearance'

window.api = createDesktopApi()

document.documentElement.dataset.platform = getPlatform()

void initializeAppearance().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})

function getPlatform(): 'macos' | 'windows' | 'linux' {
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('mac')) return 'macos'
  if (platform.includes('win')) return 'windows'
  return 'linux'
}
