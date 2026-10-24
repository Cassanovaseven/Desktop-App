// @vitest-environment jsdom
import { test, expect, vi } from 'vitest'
import type { DockviewApi } from 'dockview-react'
import { restoreLayout, buildDefaultLayout, ensurePanels, PANELS } from '../../src/renderer/layout/layout'

function fakeDockviewApi() {
  return { addPanel: vi.fn(), fromJSON: vi.fn(), toJSON: vi.fn(() => ({})), clear: vi.fn(), getPanel: vi.fn((_id: string): unknown => ({ id: _id })) }
}
const asApi = (f: ReturnType<typeof fakeDockviewApi>): DockviewApi => f as unknown as DockviewApi

test('layout tersimpan yang rusak kembali ke default', () => {
  const api = fakeDockviewApi()
  expect(restoreLayout(asApi(api), '{rusak', vi.fn())).toBe('default')
  expect(api.addPanel).toHaveBeenCalledTimes(7)
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
  expect(api.clear).toHaveBeenCalled(); expect(api.addPanel).toHaveBeenCalledTimes(7); expect(log).toHaveBeenCalled()
})
test('default layout memakai arah yang diizinkan dan judul Indonesia', () => {
  const api = fakeDockviewApi(); buildDefaultLayout(asApi(api))
  const dirs = api.addPanel.mock.calls.map(([o]) => o.position?.direction).filter(Boolean)
  for (const d of dirs) expect(['left', 'right', 'above', 'below', 'within']).toContain(d)
  expect(api.addPanel.mock.calls.map(([o]) => o.title)).toEqual(expect.arrayContaining(['Proyek', 'Library', 'Board', 'Studio', 'Deck', 'Inspector', 'Antrean & Log']))
  expect(PANELS.map(p => p.id)).toEqual(['explorer', 'library', 'board', 'studio', 'deck', 'inspector', 'queue'])
})

test('Fase 2: Library di kiri bersama Proyek, Inspector di kanan memakai komponen asli', () => {
  const api = fakeDockviewApi(); buildDefaultLayout(asApi(api))
  const byId = Object.fromEntries(api.addPanel.mock.calls.map(([o]) => [o.id, o]))
  expect(byId.library.position).toEqual({ referencePanel: 'explorer', direction: 'within' })
  expect(byId.explorer.component).toBe('projects')
  expect(byId.library.component).toBe('library')
  expect(byId.inspector.component).toBe('inspector')
})
test('Fase 2: tata letak lama tanpa Library mendapat panel Library tanpa mengubah yang lain', () => {
  const api = fakeDockviewApi()
  api.getPanel.mockImplementation((id: string) => (id === 'library' ? undefined : { id }))
  expect(restoreLayout(asApi(api), '{"grid":{}}', vi.fn())).toBe('restored')
  expect(api.addPanel).toHaveBeenCalledTimes(1)
  expect(api.addPanel.mock.calls[0][0]).toMatchObject({ id: 'library', position: { referencePanel: 'explorer', direction: 'within' } })
  expect(api.clear).not.toHaveBeenCalled()
})
test('Fase 2: ensurePanels tanpa panel Proyek menaruh Library di kiri Board', () => {
  const api = fakeDockviewApi()
  api.getPanel.mockImplementation((id: string) => (id === 'board' ? { id } : undefined))
  ensurePanels(asApi(api))
  expect(api.addPanel.mock.calls.map(([o]) => o.id)).toEqual(['library'])
  expect(api.addPanel.mock.calls[0][0].position).toEqual({ referencePanel: 'board', direction: 'left' })
})
