// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectsPanel } from '../../src/renderer/projects/ProjectsPanel'
import { workspace } from '../../src/renderer/workspace'
import type { ProjectDTO } from '../../src/shared/library-types'

let projects: ProjectDTO[]
const api = {
  list: vi.fn(async () => structuredClone(projects)),
  create: vi.fn(async (name: string) => { const p = { id: 'p' + (projects.length + 1), name, boards: [{ id: 'bn', name: 'Board Utama' }] }; projects.push(p); return p }),
  rename: vi.fn(async (id: string, name: string) => { projects.find((p) => p.id === id)!.name = name }),
  createBoard: vi.fn(async (pid: string, name: string) => { const b = { id: 'b-new', name }; projects.find((p) => p.id === pid)!.boards.push(b); return b }),
  renameBoard: vi.fn(async (id: string, name: string) => { for (const p of projects) for (const b of p.boards) if (b.id === id) b.name = name }),
  getActiveBoardId: vi.fn(async () => 'b1'),
  setActiveBoard: vi.fn(async () => {})
}
beforeEach(() => {
  projects = [
    { id: 'p1', name: 'Proyek Pertama', boards: [{ id: 'b1', name: 'Board Utama' }, { id: 'b2', name: 'Sketsa' }] },
    { id: 'p2', name: 'Riset Hukum', boards: [{ id: 'b3', name: 'Board Utama' }] }
  ]
  ;(window as any).alfonso = { projects: api }
  workspace.reset()
  workspace.setActiveBoard('b1', 'p1')
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

test('daftar proyek dan board tampil; board aktif ditandai', async () => {
  render(<ProjectsPanel />)
  expect(await screen.findByText('Riset Hukum')).toBeTruthy()
  const active = screen.getByRole('button', { current: true })
  expect(active.textContent).toContain('Board Utama')
  expect(screen.getAllByRole('button', { name: /Sketsa/ })).toHaveLength(1)
})

test('klik board → board aktif pindah', async () => {
  const user = userEvent.setup()
  render(<ProjectsPanel />)
  await user.click(await screen.findByRole('button', { name: 'Sketsa' }))
  expect(api.setActiveBoard).toHaveBeenCalledWith('b2')
  await waitFor(() => expect(workspace.get().activeBoardId).toBe('b2'))
  expect(workspace.get().activeProjectId).toBe('p1')
})

test('Proyek baru: isi nama, Enter → dibuat dan langsung dibuka', async () => {
  const user = userEvent.setup()
  render(<ProjectsPanel />)
  await user.click(await screen.findByRole('button', { name: 'Proyek baru' }))
  await user.type(screen.getByLabelText('Nama proyek baru'), 'Skripsi{Enter}')
  expect(api.create).toHaveBeenCalledWith('Skripsi')
  expect(await screen.findByText('Skripsi')).toBeTruthy()
  expect(api.setActiveBoard).toHaveBeenCalledWith('bn')
})

test('Board baru di proyek tertentu', async () => {
  const user = userEvent.setup()
  render(<ProjectsPanel />)
  const group = (await screen.findByText('Riset Hukum')).closest('li')!
  await user.click(within(group).getByRole('button', { name: 'Board baru' }))
  await user.type(screen.getByLabelText('Nama board baru'), 'Kronologi{Enter}')
  expect(api.createBoard).toHaveBeenCalledWith('p2', 'Kronologi')
  expect(await screen.findByRole('button', { name: 'Kronologi' })).toBeTruthy()
})

test('F2 mengganti nama board; Esc membatalkan', async () => {
  const user = userEvent.setup()
  render(<ProjectsPanel />)
  const sketsa = await screen.findByRole('button', { name: 'Sketsa' })
  sketsa.focus()
  await user.keyboard('{F2}')
  const box = screen.getByLabelText('Ganti nama board')
  await user.clear(box)
  await user.type(box, 'Coretan{Enter}')
  expect(api.renameBoard).toHaveBeenCalledWith('b2', 'Coretan')
  expect(await screen.findByRole('button', { name: 'Coretan' })).toBeTruthy()

  await user.dblClick(screen.getByText('Riset Hukum'))
  await user.type(screen.getByLabelText('Ganti nama proyek'), 'xx{Escape}')
  expect(api.rename).not.toHaveBeenCalled()
  expect(screen.getByText('Riset Hukum')).toBeTruthy()
})

test('error dari proses utama ditampilkan', async () => {
  api.create.mockRejectedValueOnce(new Error('Nama harus diisi, maksimal 80 karakter.'))
  const user = userEvent.setup()
  render(<ProjectsPanel />)
  await user.click(await screen.findByRole('button', { name: 'Proyek baru' }))
  await user.type(screen.getByLabelText('Nama proyek baru'), ' {Enter}')
  expect(await screen.findByRole('alert')).toBeTruthy()
})
