// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BoardPicker } from '../../src/renderer/projects/BoardPicker'
import { ProjectsPanel, projectsController } from '../../src/renderer/projects/ProjectsPanel'
import { LibraryPanel, libraryController } from '../../src/renderer/library/LibraryPanel'
import { workspace } from '../../src/renderer/workspace'

const projects = [
  { id: 'p1', name: 'Proyek Pertama', boards: [{ id: 'b1', name: 'Board Utama' }] },
  { id: 'p2', name: 'Riset Hukum', boards: [{ id: 'b2', name: 'Board Utama' }, { id: 'b3', name: 'Kronologi' }] }
]
const api = {
  projects: { list: vi.fn(async () => projects), setActiveBoard: vi.fn(async () => {}), create: vi.fn(), createBoard: vi.fn(), rename: vi.fn(), renameBoard: vi.fn() },
  library: { query: vi.fn(async () => ({ items: [], total: 0 })), tags: vi.fn(async () => []) },
  ingest: { onEvent: vi.fn(() => () => {}) }
}
beforeEach(() => { (window as any).alfonso = api; workspace.reset(); workspace.setActiveBoard('b1', 'p1') })
afterEach(() => { cleanup(); vi.clearAllMocks() })

test('Pindah ke board: saring per kata, Enter membuka board, lalu menutup', async () => {
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<BoardPicker onClose={onClose} />)
  expect(await screen.findByText('Riset Hukum › Kronologi')).toBeTruthy()
  await user.type(screen.getByLabelText('Cari board'), 'riset krono')
  expect(screen.getAllByRole('option')).toHaveLength(1)
  await user.keyboard('{Enter}')
  await waitFor(() => expect(api.projects.setActiveBoard).toHaveBeenCalledWith('b3'))
  expect(workspace.get()).toMatchObject({ activeBoardId: 'b3', activeProjectId: 'p2' })
  expect(onClose).toHaveBeenCalled()
})

test('Esc menutup pemilih board', async () => {
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<BoardPicker onClose={onClose} />)
  await screen.findByText('Proyek Pertama › Board Utama')
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
})

test('pengendali panel Proyek membuka isian proyek/board baru dari palette', async () => {
  render(<ProjectsPanel />)
  await screen.findByText('Riset Hukum')
  act(() => projectsController.newProject())
  expect(screen.getByLabelText('Nama proyek baru')).toBeTruthy()
  act(() => projectsController.newBoard('p2'))
  expect(screen.getByLabelText('Nama board baru')).toBeTruthy()
})

test('pengendali Library memfokuskan kotak cari', async () => {
  render(<LibraryPanel />)
  act(() => libraryController.focusSearch())
  expect(document.activeElement).toBe(screen.getByLabelText('Cari di Library'))
})
