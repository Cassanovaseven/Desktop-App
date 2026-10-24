import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CostEstimate, GenerationDTO, Lane, PromptDTO, PromptVersionSummary, StudioSettings } from '../../shared/studio-types'
import { CODE_MODELS } from '../../shared/studio-types'
import { CostDialog } from './CostDialog'
import { AccountSettings } from './AccountSettings'
import { GenerationList, upsertGeneration } from './GenerationList'
import { CODE_MODEL_LABEL, COMFY_OFF, LANE_LABEL, PARAM_HINT, paramsToText, textToParams } from './params'
import { studioStore, useStudioRequests } from './studio-store'

// Variabel `[NAMA]` sama dengan aturan di proses utama (src/main/studio/prompts.ts).
const VAR_RE = /\[([A-Z][A-Z0-9_]*)\]/g
export const parseVariables = (t: string): string[] => [...new Set([...t.matchAll(VAR_RE)].map((m) => m[1]))]

interface Draft {
  baseId?: string
  version?: number
  name: string
  lane: Lane
  targetModel: string
  template: string
  paramsText: string
}

const EMPTY: Draft = { name: '', lane: 'kode', targetModel: 'svg', template: '', paramsText: 'jumlah=1' }
const fromPrompt = (p: PromptDTO): Draft => ({
  baseId: p.id, version: p.version, name: p.name, lane: p.lane, targetModel: p.targetModel, template: p.template, paramsText: paramsToText(p.params)
})
const defaultModel = (lane: Lane): string => (lane === 'kode' ? 'svg' : lane === 'lokal' ? 'comfyui' : '')

interface Source { cardId: string; label: string; text: string | null }

export function StudioPanel(): React.JSX.Element {
  const api = window.alfonso.studio
  const [prompts, setPrompts] = useState<PromptDTO[]>([])
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [saved, setSaved] = useState<Draft | null>(null)
  const [history, setHistory] = useState<PromptVersionSummary[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [source, setSource] = useState<Source | null>(null)
  const [settings, setSettings] = useState<StudioSettings | null>(null)
  const [showAccount, setShowAccount] = useState(false)
  const [gens, setGens] = useState<GenerationDTO[]>([])
  const [confirm, setConfirm] = useState<{ model: string; estimate: CostEstimate; go(): Promise<void> } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [comfyOff, setComfyOff] = useState(false)
  const [workflowName, setWorkflowName] = useState<string | null>(null)
  const requests = useStudioRequests()

  const refreshPrompts = useCallback(() => api.listPrompts(q.trim() ? { q: q.trim() } : {}).then(setPrompts), [api, q])
  useEffect(() => {
    void refreshPrompts()
  }, [refreshPrompts])
  useEffect(() => {
    void api.settings().then(setSettings)
    void api.generations(30).then(setGens)
    return api.onEvent((e) => setGens((list) => upsertGeneration(list, e.generation)))
  }, [api])

  // Permintaan dari luar: klik kanan kartu → "Generate dari ini", Inspector, palette.
  useEffect(() => {
    const r = studioStore.take()
    if (!r) return
    if (r.account) setShowAccount(true)
    if (r.newPrompt) resetDraft()
    if (r.sourceCardId) {
      setSource({ cardId: r.sourceCardId, label: r.sourceLabel ?? 'Kartu', text: r.sourceText ?? null })
      if (r.sourceText) setValues((v) => (v.SUMBER_TEKS ? v : { ...v, SUMBER_TEKS: r.sourceText!.slice(0, 20_000) }))
    }
    if (r.promptId) void api.getPrompt(r.promptId).then((p) => p && load(p))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests])

  const params = useMemo(() => {
    try {
      return { value: textToParams(draft.paramsText), error: null as string | null }
    } catch (e) {
      return { value: {}, error: (e as Error).message }
    }
  }, [draft.paramsText])
  const workflowId = typeof params.value.workflow === 'string' ? params.value.workflow : null
  useEffect(() => {
    if (!workflowId) return setWorkflowName(null)
    void api.assetName(workflowId).then(setWorkflowName)
  }, [api, workflowId])

  const variables = useMemo(() => parseVariables(draft.template), [draft.template])
  const dirty = !saved || JSON.stringify({ ...saved, version: undefined }) !== JSON.stringify({ ...draft, version: undefined })

  function load(p: PromptDTO): void {
    const d = fromPrompt(p)
    setDraft(d)
    setSaved(d)
    setError(null)
    setMessage(null)
    setComfyOff(false)
    void api.history(p.id).then(setHistory)
  }

  function resetDraft(): void {
    setDraft(EMPTY)
    setSaved(null)
    setHistory([])
    setValues({})
  }

  const set = (patch: Partial<Draft>): void => setDraft((d) => ({ ...d, ...patch }))

  async function save(): Promise<PromptDTO> {
    if (params.error) throw new Error(params.error)
    const p = await api.savePrompt({
      baseId: draft.baseId, name: draft.name, lane: draft.lane, targetModel: draft.targetModel, template: draft.template, params: params.value
    })
    load(p)
    await refreshPrompts()
    return p
  }

  const act = async (fn: () => Promise<void>): Promise<void> => {
    setError(null)
    setMessage(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const missing = variables.filter((v) => !(values[v] ?? '').trim())

  async function generate(): Promise<void> {
    if (missing.length) throw new Error(`Variabel belum diisi: ${missing.join(', ')}`)
    if (draft.lane === 'cloud' && settings?.higgsfield !== 'tersimpan') {
      setShowAccount(true)
      throw new Error('Kunci Higgsfield belum diatur atau ditolak. Isi di Akun & biaya.')
    }
    if (draft.lane === 'lokal' && !(await api.comfyStatus())) {
      setComfyOff(true)
      throw new Error(`${COMFY_OFF}. Jalankan ComfyUI dulu, atau pindah ke jalur cloud.`)
    }
    const p = dirty ? await save() : (await api.getPrompt(draft.baseId!))!
    const vars = Object.fromEntries(parseVariables(p.template).map((v) => [v, values[v] ?? '']))
    const send = async (confirmedCost: boolean): Promise<void> => {
      const out = await api.generate({ promptId: p.id, variables: vars, sourceCardId: source?.cardId ?? null, confirmedCost })
      setMessage(out.length > 1 ? `${out.length} generate masuk antrean.` : 'Generate masuk antrean.')
    }
    if (p.lane === 'cloud') {
      const estimate = await api.estimate(p.id)
      setConfirm({ model: p.targetModel, estimate, go: () => send(true) })
      return
    }
    await send(false)
  }

  async function retry(g: GenerationDTO): Promise<void> {
    if (g.lane === 'cloud') {
      const estimate = await api.estimateGeneration(g.id)
      setConfirm({ model: g.model ?? '', estimate, go: async () => void (await api.retry(g.id, true)) })
      return
    }
    await api.retry(g.id)
  }

  const switchToCloud = (): void => {
    // Tidak pindah otomatis (spec 7): hanya mengubah formulir; model Higgsfield dipilih sendiri lalu Generate lagi.
    set({ lane: 'cloud', targetModel: '', baseId: draft.baseId })
    setComfyOff(false)
    setMessage('Jalur diubah ke cloud. Isi model Higgsfield, lalu tekan Generate.')
  }

  return (
    <div className="studio-panel">
      <aside className="studio-library" aria-label="Prompt library">
        <div className="studio-row">
          <input aria-label="Cari prompt" placeholder="Cari prompt…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" onClick={resetDraft}>
            Prompt baru
          </button>
        </div>
        {prompts.length === 0 ? (
          <p className="inspector-muted">{q ? 'Tidak ada yang cocok.' : 'Belum ada prompt. Tulis yang pertama di sebelah kanan.'}</p>
        ) : (
          <ul className="studio-prompts">
            {prompts.map((p) => (
              <li key={p.id}>
                <button type="button" className={draft.baseId && history.some((h) => h.id === p.id) ? 'selected' : ''} onClick={() => load(p)}>
                  <span>{p.name}</span>
                  <span className="inspector-muted">{`${LANE_LABEL[p.lane]} · v${p.version}`}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="studio-editor" aria-label="Editor prompt">
        <div className="studio-row">
          <label>
            Nama
            <input aria-label="Nama prompt" value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
          </label>
          <label>
            Jalur
            <select aria-label="Jalur" value={draft.lane} onChange={(e) => set({ lane: e.target.value as Lane, targetModel: defaultModel(e.target.value as Lane) })}>
              {(['kode', 'cloud', 'lokal'] as Lane[]).map((l) => (
                <option key={l} value={l}>
                  {LANE_LABEL[l]}
                </option>
              ))}
            </select>
          </label>
          {draft.lane === 'kode' && (
            <label>
              Model
              <select aria-label="Model" value={draft.targetModel} onChange={(e) => set({ targetModel: e.target.value })}>
                {CODE_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {CODE_MODEL_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {draft.lane === 'cloud' && (
            <label>
              Model Higgsfield
              <input aria-label="Model" list="studio-models" value={draft.targetModel} placeholder="bytedance/seedream/v4/text-to-image" onChange={(e) => set({ targetModel: e.target.value })} />
              <datalist id="studio-models">
                {[...new Set([...Object.keys(settings?.costs ?? {}), ...prompts.filter((p) => p.lane === 'cloud').map((p) => p.targetModel)])].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          )}
          {draft.lane === 'lokal' && (
            <div className="studio-workflow">
              <span>{workflowName ? `Workflow: ${workflowName}` : 'Workflow belum dipilih'}</span>
              <button
                type="button"
                onClick={() =>
                  void act(async () => {
                    const wf = await api.pickWorkflow()
                    if (!wf) return
                    const p = { ...params.value, workflow: wf.assetId }
                    set({ paramsText: paramsToText(p) })
                  })
                }
              >
                Pilih workflow…
              </button>
            </div>
          )}
        </div>
        {draft.version !== undefined && (
          <div className="studio-row inspector-muted">
            <span>{`Versi ${draft.version}${dirty ? ' · belum disimpan' : ''}`}</span>
            {history.length > 1 && (
              <select
                aria-label="Riwayat versi"
                value=""
                onChange={(e) => e.target.value && void api.getPrompt(e.target.value).then((p) => p && setDraft({ ...fromPrompt(p), baseId: p.id }))}
              >
                <option value="">Lihat versi lain…</option>
                {history.map((h) => (
                  <option key={h.id} value={h.id}>{`Versi ${h.version}`}</option>
                ))}
              </select>
            )}
          </div>
        )}
        <label className="studio-block">
          Template
          <textarea
            aria-label="Template"
            className="studio-template"
            value={draft.template}
            onChange={(e) => set({ template: e.target.value })}
            placeholder={draft.lane === 'kode' ? (draft.targetModel === 'svg' ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">…[WARNA]…</svg>' : 'function setup() { createCanvas(LEBAR, TINGGI) }\nfunction draw() { background(20); circle(frameCount * 4, TINGGI / 2, 40) }') : 'Tulis prompt; [NAMA] menjadi variabel.'}
            spellCheck={false}
          />
        </label>
        <label className="studio-block">
          Parameter
          <textarea aria-label="Parameter" className="studio-params" value={draft.paramsText} onChange={(e) => set({ paramsText: e.target.value })} spellCheck={false} />
          <span className="inspector-muted">{PARAM_HINT[draft.lane]}</span>
        </label>
        {params.error && <div className="panel-error">{params.error}</div>}

        {variables.length > 0 && (
          <fieldset className="studio-vars">
            <legend>Variabel</legend>
            {variables.map((v) => (
              <label key={v}>
                {v}
                <input aria-label={`Variabel ${v}`} value={values[v] ?? ''} onChange={(e) => setValues((x) => ({ ...x, [v]: e.target.value }))} />
              </label>
            ))}
          </fieldset>
        )}

        {source && (
          <div className="studio-source">
            <span>{`Referensi: ${source.label}`}</span>
            <button type="button" onClick={() => setSource(null)}>
              Lepas referensi
            </button>
          </div>
        )}

        <div className="studio-actions">
          <button type="button" disabled={!dirty} onClick={() => void act(async () => void (await save()))}>
            {draft.baseId ? 'Simpan versi baru' : 'Simpan prompt'}
          </button>
          <button type="button" className="primary" onClick={() => void act(generate)}>
            Generate
          </button>
          <button type="button" onClick={() => setShowAccount((x) => !x)} aria-expanded={showAccount}>
            Akun & biaya
          </button>
        </div>
        {comfyOff && (
          <div className="studio-source" role="alert">
            <span>{`${COMFY_OFF}. Alfonso tidak pindah jalur sendiri.`}</span>
            <button type="button" onClick={switchToCloud}>
              Pindah ke cloud
            </button>
          </div>
        )}
        {error && <div className="panel-error" role="alert">{error}</div>}
        {message && <div className="studio-message" role="status">{message}</div>}
        {showAccount && settings && <AccountSettings settings={settings} onChange={setSettings} />}
      </section>

      <section className="studio-history" aria-label="Riwayat">
        <h3>Riwayat generate</h3>
        <GenerationList items={gens} onRetry={(g) => void act(() => retry(g))} onSwitchToCloud={() => switchToCloud()} />
      </section>

      {confirm && (
        <CostDialog
          model={confirm.model}
          estimate={confirm.estimate}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const c = confirm
            setConfirm(null)
            void act(c.go)
          }}
        />
      )}
    </div>
  )
}
