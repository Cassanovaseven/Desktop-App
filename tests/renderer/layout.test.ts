// @vitest-environment jsdom
import { test, expect, vi } from 'vitest'
import type { DockviewApi } from 'dockview-react'
import { restoreLayout, buildDefaultLayout, PANELS } from '../../src/renderer/layout/layout'

function fakeDockviewApi() {
  return { addPanel: vi.fn(), fromJSON: vi.fn(), toJSON: vi.fn(() => ({})), clear: vi.fn() }
}
const asApi = (f: ReturnType<typeof fakeDockviewApi>): DockviewApi => f as unknown as DockviewApi

test('layout tersimpan yang rusak kembali ke default', () => {
  const api = fakeDockviewApi()
  expect(restoreLayout(asApi(api), '{rusak', vi.fn())).toBe('default')
  expect(api.addPanel).toHaveBeenCalledTimes(6)
})
test('layout kosong memakai default', () => { expect(restoreLayout(asApi(fakeDockviewApi()), null, vi.fn())).toBe('default') })
test('layout valid dipulihkan', () => {
  const api = fakeDockviewApi(); expect(restoreLayout(asApi(api), '{"grid":{}}', vi.fn())).toBe('restored')
  expect(api.fromJSON).toHaveBeenCalled()
})
test('fromJSON melempar → clear lalu default', () => {
  const api = fakeDockviewApi(); api.fromJSON.mockImplementation(() => { throw new Error('rusak') })
  const log = vi.fn()
  expect(restoreLayout(asApi(api), '{"grid":{}}', log)).toBe('default')
  expect(api.clear).toHaveBeenCalled(); expect(api.addPanel).toHaveBeenCalledTimes(6); expect(log).toHaveBeenCalled()
})
test('default layout memakai arah yang diizinkan dan judul Indonesia', () => {
  const api = fakeDockviewApi(); buildDefaultLayout(asApi(api))
  const dirs = api.addPanel.mock.calls.map(([o]) => o.position?.direction).filter(Boolean)
  for (const d of dirs) expect(['left', 'right', 'above', 'below', 'within']).toContain(d)
  expect(api.addPanel.mock.calls.map(([o]) => o.title)).toEqual(expect.arrayContaining(['Proyek', 'Board', 'Studio', 'Deck', 'Inspector', 'Antrean & Log']))
  expect(PANELS.map(p => p.id)).toEqual(['explorer', 'board', 'studio', 'deck', 'inspector', 'queue'])
})
