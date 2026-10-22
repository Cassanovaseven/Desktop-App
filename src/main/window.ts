import type { BrowserWindowConstructorOptions } from 'electron'

export function secureWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    title: 'Alfonso',
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  }
}
