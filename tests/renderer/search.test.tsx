// @vitest-environment jsdom
import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchBox } from '../../src/renderer/search/SearchBox'

afterEach(() => cleanup())

test('mengetik mencari isi file, Enter memusatkan kartu hasil lalu menutup', async () => {
  const query = vi.fn(async () => [{ assetId: 'a1', cardIds: ['c9'], originalName: 'laporan.pdf', snippet: '…pertanggungjawaban pidana…' }])
  const onPick = vi.fn(); const onClose = vi.fn()
  const user = userEvent.setup()
  render(<SearchBox query={query} onPick={onPick} onClose={onClose} />)
  await user.type(screen.getByLabelText('Cari isi file'), 'pidana')
  expect(await screen.findByText('laporan.pdf')).toBeTruthy()
  expect(screen.getByText('…pertanggungjawaban pidana…')).toBeTruthy()
  await waitFor(() => expect(query).toHaveBeenLastCalledWith('pidana'))
  await user.keyboard('{Enter}')
  expect(onPick).toHaveBeenCalledWith('c9'); expect(onClose).toHaveBeenCalled()
})
test('tanpa hasil menampilkan pesan, Esc menutup', async () => {
  const onClose = vi.fn(); const user = userEvent.setup()
  render(<SearchBox query={async () => []} onPick={vi.fn()} onClose={onClose} />)
  await user.type(screen.getByLabelText('Cari isi file'), 'zzz')
  expect(await screen.findByText('Tidak ada file yang cocok')).toBeTruthy()
  await user.keyboard('{Escape}'); expect(onClose).toHaveBeenCalled()
})
