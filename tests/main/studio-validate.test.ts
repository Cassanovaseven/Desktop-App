import { test, expect } from 'vitest'
import { parseGenerateRequest, parsePromptInput, parseComfyUrl, parseParams } from '../../src/main/studio/validate'

test('parsePromptInput: hanya field yang dikenal, tipe dicek', () => {
  expect(parsePromptInput({ name: 'a', lane: 'kode', targetModel: 'svg', template: '<svg/>', params: { lebar: 10 }, extra: 1, baseId: 'p1' }))
    .toEqual({ name: 'a', lane: 'kode', targetModel: 'svg', template: '<svg/>', params: { lebar: 10 }, baseId: 'p1', projectId: null })
  expect(() => parsePromptInput(null)).toThrow()
  expect(() => parsePromptInput({ name: 1, lane: 'kode', targetModel: 'svg', template: 'x' })).toThrow()
  expect(() => parsePromptInput({ name: 'a', lane: 'kode', targetModel: 'svg', template: 'x', baseId: 3 })).toThrow()
})

test('parseGenerateRequest: variabel teks (maks. 20.000), posisi angka, konfirmasi boolean', () => {
  expect(parseGenerateRequest({ promptId: 'p', variables: { A: 'x' }, at: { x: 1, y: 2 }, confirmedCost: true, sourceCardId: 'c', params: { seed: 4 } }))
    .toEqual({ promptId: 'p', variables: { A: 'x' }, at: { x: 1, y: 2 }, confirmedCost: true, sourceCardId: 'c', params: { seed: 4 } })
  expect(parseGenerateRequest({ promptId: 'p', variables: {} })).toEqual({ promptId: 'p', variables: {}, at: null, confirmedCost: false, sourceCardId: null })
  expect(() => parseGenerateRequest({ promptId: 'p', variables: { A: 1 } })).toThrow()
  expect(() => parseGenerateRequest({ promptId: 'p', variables: { A: 'x'.repeat(20_001) } })).toThrow()
  expect(() => parseGenerateRequest({ promptId: 'p', variables: {}, at: { x: 'a', y: 1 } })).toThrow()
  expect(() => parseGenerateRequest({ promptId: 'p', variables: {}, confirmedCost: 'ya' })).toThrow()
  expect(() => parseGenerateRequest({ variables: {} })).toThrow()
})

test('parseParams menolak objek bersarang', () => {
  expect(parseParams({ a: 1, b: 'x', c: true })).toEqual({ a: 1, b: 'x', c: true })
  expect(() => parseParams({ a: { b: 1 } })).toThrow()
  expect(() => parseParams([1])).toThrow()
})

test('alamat ComfyUI hanya localhost http', () => {
  expect(parseComfyUrl(' http://127.0.0.1:8188/ ')).toBe('http://127.0.0.1:8188')
  expect(parseComfyUrl('http://localhost:9000')).toBe('http://localhost:9000')
  for (const bad of ['https://127.0.0.1:8188', 'http://10.0.0.2:8188', 'http://127.0.0.1:8188/x', 'ftp://localhost', 'http://user@127.0.0.1:8188', 'bukan url'])
    expect(() => parseComfyUrl(bad)).toThrow()
})
