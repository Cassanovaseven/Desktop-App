import { test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createLogger, redact } from '../../src/main/logger'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alfonso-log-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

test('redact menyembunyikan token', () => {
  expect(redact('token=abc123 ok', ['abc123'])).toBe('token=[DISEMBUNYIKAN] ok')
})
test('logger tidak menulis rahasia ke file', () => {
  const log = createLogger(tmp, () => ['rahasia42']); log.info('mulai rahasia42')
  const isi = fs.readdirSync(tmp).map(f => fs.readFileSync(path.join(tmp, f), 'utf8')).join('')
  expect(isi).toContain('[DISEMBUNYIKAN]'); expect(isi).not.toContain('rahasia42')
})
