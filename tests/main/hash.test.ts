import { test, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { sha256File } from '../../src/main/ingest/hash'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alfonso-hash-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

test('hash file 0 byte dan 5 MB sama dengan crypto sekali jalan', async () => {
  const kosong = path.join(tmp, 'kosong.bin'); fs.writeFileSync(kosong, '')
  const besar = path.join(tmp, 'Besar Sekalí.bin'); const buf = crypto.randomBytes(5 * 1024 * 1024); fs.writeFileSync(besar, buf)
  expect(await sha256File(kosong)).toBe(crypto.createHash('sha256').update('').digest('hex'))
  expect(await sha256File(besar)).toBe(crypto.createHash('sha256').update(buf).digest('hex'))
})
test('file tidak ada → error', async () => {
  await expect(sha256File(path.join(tmp, 'hilang.txt'))).rejects.toThrow()
})
