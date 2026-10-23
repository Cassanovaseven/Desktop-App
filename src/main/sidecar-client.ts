import type { SidecarManager } from './sidecar'
import { PermanentError, type ExtractResult } from './ingest/service'

export function createSidecarExtractor(sidecar: SidecarManager) {
  return async (vaultRelPath: string, assetId: string): Promise<ExtractResult> => {
    const { state, port } = sidecar.getStatus()
    if (state !== 'ready' || !port) throw new Error('Sidecar belum siap')
    const res = await fetch(`http://127.0.0.1:${port}/extract`, {
      method: 'POST',
      headers: { 'X-Alfonso-Token': sidecar.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: vaultRelPath, asset_id: assetId }),
      signal: AbortSignal.timeout(120_000)
    })
    if (res.ok) return (await res.json()) as ExtractResult
    const detail = ((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? `HTTP ${res.status}`
    // 4xx = masalah file/permintaan (tidak sembuh dengan dicoba ulang); 5xx = sidecar bermasalah, coba lagi.
    if (res.status >= 400 && res.status < 500) throw new PermanentError(detail)
    throw new Error(detail)
  }
}
