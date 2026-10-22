import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import terangJson from '../src/shared/themes/alfonso-terang.json'

const terang = terangJson as { colors: { bg: string } }

// Daftar proses sidecar yang masih hidup. Windows memakai PowerShell Get-CimInstance.
function sidecarPythonProcesses(): string[] {
  if (process.platform === 'win32') {
    const out = execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json"
    ]).toString().trim()
    if (!out) return []
    const rows = ([] as { CommandLine: string | null }[]).concat(JSON.parse(out))
    return rows.map((r) => r.CommandLine ?? '').filter((c) => c.includes('alfonso_sidecar'))
  }
  return execFileSync('ps', ['-eo', 'args']).toString().split('\n').filter((l) => l.includes('-m alfonso_sidecar'))
}

let base: string
let vault: string
let userData: string
test.beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'alfonso-e2e-'))
  vault = path.join(base, 'Dokumen Kerja', 'Vault Alfonsó')
  userData = path.join(base, 'userData')
})
test.afterEach(() => { fs.rmSync(base, { recursive: true, force: true }) })

function launch(): Promise<ElectronApplication> {
  // Chromium menolak berjalan sebagai root di Linux tanpa --no-sandbox (hanya untuk CI/container).
  const rootOnLinux = process.platform === 'linux' && process.getuid?.() === 0
  return electron.launch({
    args: rootOnLinux ? ['.', '--no-sandbox'] : ['.'],
    env: { ...process.env, ALFONSO_VAULT: vault, ALFONSO_USER_DATA: userData }
  })
}

test('Fase 0 berjalan dari awal', async () => {
  const app = await launch()
  const win = await app.firstWindow()
  await expect(win).toHaveTitle('Alfonso')
  for (const d of ['files', 'thumbs', 'generated', 'prompts', 'mods', 'logs', 'alfonso.db']) expect(fs.existsSync(path.join(vault, d))).toBe(true)
  await expect(win.getByText(/Sidecar: siap/)).toBeVisible({ timeout: 20000 })
  expect(await win.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined')
  await win.keyboard.press('Control+K')
  await win.getByLabel('Cari perintah').fill('terang'); await win.keyboard.press('Enter')
  const bg = await win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim())
  expect(bg).toBe(terang.colors.bg)
  // Tutup panel Inspector supaya tata letak berubah dan tersimpan (debounce 500 ms).
  await win.locator('.dv-tab', { hasText: 'Inspector' }).locator('.dv-default-tab-action').click()
  await expect(win.getByText('Inspector', { exact: true })).toHaveCount(0)
  await win.waitForTimeout(1000)
  await app.close()
  expect(sidecarPythonProcesses()).toHaveLength(0)

  // Dibuka ulang: tema terang dan tata letak tetap.
  const app2 = await launch()
  const win2 = await app2.firstWindow()
  await expect(win2.getByText(/Sidecar: siap/)).toBeVisible({ timeout: 20000 })
  const bg2 = await win2.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim())
  expect(bg2).toBe(terang.colors.bg)
  await expect(win2.getByText('Inspector', { exact: true })).toHaveCount(0)
  await expect(win2.getByText('Board', { exact: true })).toBeVisible()
  await app2.close()
  expect(sidecarPythonProcesses()).toHaveLength(0)
})
