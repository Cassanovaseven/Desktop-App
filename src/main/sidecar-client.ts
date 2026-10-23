import type { SidecarManager } from './sidecar'
import { PermanentError, type ExtractResult } from './ingest/service'

const MINUTE = 60_000

async function call<T>(sidecar: SidecarManager, method: 'GET' | 'POST', route: string, body: unknown, timeoutMs: number): Promise<T> {
  const { state, port } = sidecar.getStatus()
  if (state !== 'ready' || !port) throw new Error('Sidecar belum siap')
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { 'X-Alfonso-Token': sidecar.token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (res.ok) return (await res.json()) as T
  const detail = ((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? `HTTP ${res.status}`
  // 4xx = masalah file/permintaan (tidak sembuh dengan dicoba ulang); 5xx = sidecar bermasalah, coba lagi.
  if (res.status >= 400 && res.status < 500) throw new PermanentError(detail)
  throw new Error(detail)
}

export function createSidecarExtractor(sidecar: SidecarManager) {
  return (vaultRelPath: string, assetId: string): Promise<ExtractResult> =>
    call(sidecar, 'POST', '/extract', { path: vaultRelPath, asset_id: assetId }, 2 * MINUTE)
}

export function createSidecarTranscriber(sidecar: SidecarManager, model: () => string) {
  return (vaultRelPath: string, assetId: string): Promise<{ text: string }> =>
    call(sidecar, 'POST', '/transcribe', { path: vaultRelPath, asset_id: assetId, model: model() }, 60 * MINUTE)
}

export function createSidecarModelClient(sidecar: SidecarManager) {
  return {
    status: (model: string) => call<{ model: string; siap: boolean }>(sidecar, 'GET', `/models/whisper?model=${encodeURIComponent(model)}`, undefined, MINUTE),
    download: async (model: string) => {
      await call(sidecar, 'POST', '/models/whisper/download', { model }, 60 * MINUTE)
    }
  }
}
