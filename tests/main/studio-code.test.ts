import { test, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createCodeAdapter, validateSvg, renderSize, type P5Renderer } from '../../src/main/studio/adapters/code'
import type { GenerationDTO } from '../../src/shared/studio-types'

const made: string[] = []
afterEach(() => { for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

const gen = (model: string, text: string, params: Record<string, string | number | boolean> = {}): GenerationDTO => ({
  id: 'g1', promptId: 'p1', promptName: 'x', promptVersion: 1, promptText: text, variables: {}, model, params, lane: 'kode',
  source: model === 'svg' ? 'svg' : 'p5', creditCost: 0, status: 'berjalan', error: null, resultAssetId: null, sourceCardId: null, createdAt: 't', updatedAt: null
})

test('SVG valid diterima apa adanya (boleh diawali deklarasi XML / komentar)', () => {
  const ok = '<?xml version="1.0"?>\n<!-- ikon -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><use href="#a"/><image href="data:image/png;base64,AAAA"/></svg>\n'
  expect(validateSvg(ok)).toBe(ok)
})

test.each([
  ['bukan svg', '<html></html>'],
  ['script', '<svg><script>alert(1)</script></svg>'],
  ['event handler', '<svg><rect onload="x()"/></svg>'],
  ['event handler kutip tunggal', "<svg><rect\nonclick='x()'/></svg>"],
  ['javascript:', '<svg><a href="javascript:alert(1)"/></svg>'],
  ['href luar', '<svg><image href="https://evil.test/a.png"/></svg>'],
  ['xlink luar', '<svg><image xlink:href="//evil.test/a.png"/></svg>'],
  ['foreignObject', '<svg><foreignObject><div/></foreignObject></svg>'],
  ['url luar di style', '<svg><style>rect{fill:url(https://evil.test/x)}</style></svg>'],
  ['@import', '<svg><style>@import "x.css";</style></svg>'],
  ['iframe', '<svg><iframe/></svg>'],
  ['tidak ditutup', '<svg>']
])('SVG ditolak: %s', (_n, svg) => {
  expect(() => validateSvg(svg)).toThrow(/SVG/)
})

test('ukuran render dari parameter, dibatasi 16–4096', () => {
  expect(renderSize({})).toEqual({ width: 1024, height: 1024 })
  expect(renderSize({ lebar: 1920, tinggi: 1080 })).toEqual({ width: 1920, height: 1080 })
  expect(renderSize({ lebar: 99999, tinggi: 2 })).toEqual({ width: 4096, height: 16 })
  expect(renderSize({ rasio: '16:9', lebar: 1920 })).toEqual({ width: 1920, height: 1080 })
})

function fakeRenderer(): P5Renderer & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    async renderImage(req) { calls.push(['gambar', req]); return Buffer.from('PNG') },
    async renderFrames(req, onFrame) {
      calls.push(['motion', req])
      for (let i = 0; i < req.frames; i++) await onFrame(i, Buffer.from(`F${i}`))
    }
  }
}

test('svg → file .svg di folder sementara', async () => {
  const a = createCodeAdapter({ renderer: fakeRenderer(), encodeVideo: async () => { throw new Error('tidak dipakai') } })
  const r = await a.run(gen('svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'))
  made.push(r.tempDir)
  expect(r.ext).toBe('svg')
  expect(fs.readFileSync(r.file, 'utf8')).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>')
  expect(path.dirname(path.resolve(r.tempDir))).toBe(path.resolve(os.tmpdir()))
  expect(path.basename(r.tempDir)).toMatch(/^alfonso-gen-/)
})

test('SVG berbahaya → error permanen (tidak dicoba ulang)', async () => {
  const a = createCodeAdapter({ renderer: fakeRenderer(), encodeVideo: async () => { throw new Error('x') } })
  await expect(a.run(gen('svg', '<svg><script/></svg>'))).rejects.toMatchObject({ permanent: true })
})

test('p5 gambar → PNG dengan seed dan ukuran dari parameter', async () => {
  const r0 = fakeRenderer()
  const a = createCodeAdapter({ renderer: r0, encodeVideo: async () => { throw new Error('x') } })
  const r = await a.run(gen('p5-gambar', 'function setup(){}', { seed: 5, lebar: 800, tinggi: 600 }))
  made.push(r.tempDir)
  expect(r.ext).toBe('png')
  expect(fs.readFileSync(r.file, 'utf8')).toBe('PNG')
  expect(r0.calls[0]).toEqual(['gambar', { code: 'function setup(){}', seed: 5, width: 800, height: 600 }])
})

test('p5 motion → frame ditulis berurutan ke folder alfonso-frames-, dirakit, lalu folder frame dihapus', async () => {
  let seen: { dir: string; fps: number; files: string[] } | null = null
  const r0 = fakeRenderer()
  const a = createCodeAdapter({
    renderer: r0,
    encodeVideo: async (dir, fps) => {
      seen = { dir, fps, files: fs.readdirSync(dir).sort() }
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'alfonso-gen-'))
      fs.writeFileSync(path.join(out, 'hasil.mp4'), 'MP4')
      return { path: path.join(out, 'hasil.mp4'), tempDir: out }
    }
  })
  const r = await a.run(gen('p5-motion', 'function draw(){}', { seed: 1, durasi: 0.1, fps: 30 }))
  made.push(r.tempDir)
  expect(seen!.fps).toBe(30)
  expect(seen!.files).toEqual(['00000.png', '00001.png', '00002.png'])
  expect(path.basename(seen!.dir)).toMatch(/^alfonso-frames-/)
  expect(fs.existsSync(seen!.dir)).toBe(false)
  expect(r).toMatchObject({ ext: 'mp4' })
  expect((r0.calls[0] as [string, { frames: number }])[1].frames).toBe(3)
})

test('p5 motion: durasi > 20 detik atau fps aneh ditolak permanen', async () => {
  const a = createCodeAdapter({ renderer: fakeRenderer(), encodeVideo: async () => { throw new Error('x') } })
  await expect(a.run(gen('p5-motion', 'x', { durasi: 21, fps: 30 }))).rejects.toMatchObject({ permanent: true })
  await expect(a.run(gen('p5-motion', 'x', { durasi: 2, fps: 7 }))).rejects.toMatchObject({ permanent: true })
})
