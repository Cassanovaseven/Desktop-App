import { test, expect } from 'vitest'
import { secureWindowOptions } from '../../src/main/window'

test('jendela memakai pengaturan keamanan', () => {
  const o = secureWindowOptions('C:/x/preload.js')
  expect(o.webPreferences?.contextIsolation).toBe(true)
  expect(o.webPreferences?.nodeIntegration).toBe(false)
  expect(o.webPreferences?.sandbox).toBe(true)
  expect(o.webPreferences?.preload).toBe('C:/x/preload.js')
  expect(o.title).toBe('Alfonso')
})
