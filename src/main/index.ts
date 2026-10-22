import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { secureWindowOptions } from './window'

function createWindow(): void {
  const win = new BrowserWindow(secureWindowOptions(join(__dirname, '../preload/index.js')))
  win.once('ready-to-show', () => win.show())

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => app.quit())
