import { test, expect, vi, beforeEach } from 'vitest'
import { workspace } from '../../src/renderer/workspace'

beforeEach(() => workspace.reset())

test('board aktif, pilihan, dan fokus tertunda memberi tahu pendengar', () => {
  const fn = vi.fn()
  const off = workspace.subscribe(fn)
  workspace.setActiveBoard('b1', 'p1')
  workspace.select({ kind: 'asset', assetId: 'a1' })
  expect(workspace.get()).toMatchObject({ activeBoardId: 'b1', activeProjectId: 'p1', selection: { kind: 'asset', assetId: 'a1' } })
  expect(fn).toHaveBeenCalledTimes(2)
  workspace.requestFocus('c9')
  expect(workspace.takeFocus()).toBe('c9')
  expect(workspace.takeFocus()).toBeNull()
  workspace.bumpLibrary()
  expect(workspace.get().libraryVersion).toBe(1)
  off()
  workspace.select(null)
  expect(fn).toHaveBeenCalledTimes(4)
})

test('setActiveBoard ke board yang sama tidak memicu apa pun', () => {
  workspace.setActiveBoard('b1', 'p1')
  const fn = vi.fn()
  workspace.subscribe(fn)
  workspace.setActiveBoard('b1', 'p1')
  expect(fn).not.toHaveBeenCalled()
})
