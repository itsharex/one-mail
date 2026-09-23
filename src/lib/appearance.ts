import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { AppTheme } from '@renderer/shared/types'

function applyDomTheme(theme: AppTheme): void {
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(theme)
  document.documentElement.style.colorScheme = theme
  window.localStorage.setItem('theme', theme)
}

export function setAppTheme(theme: AppTheme): void {
  applyDomTheme(theme)
  void window.api.system.setTitleBarTheme(theme)
    .catch((error) => console.warn('Failed to update the title bar theme.', error))
}

export async function initializeAppearance(): Promise<void> {
  const savedTheme = window.localStorage.getItem('theme')
  const initialTheme: AppTheme = savedTheme === 'dark' ? 'dark' : 'light'
  applyDomTheme(initialTheme)

  if (getCurrentWindow().label === 'main') {
    setAppTheme(initialTheme)
  } else {
    let receivedThemeEvent = false
    void listen<AppTheme>('appearance/themeChanged', (event) => {
      receivedThemeEvent = true
      applyDomTheme(event.payload)
    }).catch((error) => console.warn('Failed to subscribe to theme changes.', error))
    try {
      const theme = await window.api.system.getTheme()
      if (theme && !receivedThemeEvent) {
        applyDomTheme(theme)
        await window.api.system.setTitleBarTheme(theme)
      }
    } catch (error) {
      console.warn('Failed to load the app theme.', error)
    }
  }
}
