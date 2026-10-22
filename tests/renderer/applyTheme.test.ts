// @vitest-environment jsdom
import { test, expect } from 'vitest'
import terangJson from '../../src/shared/themes/alfonso-terang.json'
import gelapJson from '../../src/shared/themes/alfonso-gelap.json'
import type { ThemeTokens } from '../../src/shared/types'
import { applyTheme } from '../../src/renderer/theme/applyTheme'

const terang = terangJson as ThemeTokens
const gelap = gelapJson as ThemeTokens

test('applyTheme menulis variabel dan mode', () => {
  applyTheme(terang)
  expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe(terang.colors.bg)
  expect(document.documentElement.dataset.themeMode).toBe('light')
})
test('applyTheme bisa diarahkan ke elemen lain dan mengganti tema', () => {
  const el = document.createElement('div')
  applyTheme(terang, el); applyTheme(gelap, el)
  expect(el.style.getPropertyValue('--color-surface-alt')).toBe(gelap.colors.surfaceAlt)
  expect(el.dataset.themeMode).toBe('dark')
})
