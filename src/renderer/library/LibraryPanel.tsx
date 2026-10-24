import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AssetStatus } from '../../shared/board-types'
import type { Jenis, LibraryItem, LibraryQuery, LibraryScope, LibrarySort, TagCount } from '../../shared/library-types'
import { JENIS } from '../../shared/library-types'
import { useWorkspace, workspace } from '../workspace'
import { columnsFor, visibleRange } from './windowing'

/** Tipe data drag & drop dari Library ke Board: isinya hanya id aset. */
export const ASSET_DRAG_TYPE = 'application/x-alfonso-asset'

const PAGE = 200
const GRID = { minWidth: 150, rowHeight: 190 }
const LIST = { rowHeight: 44 }
// jsdom dan panel yang belum terukur: ukuran cadangan supaya isi tetap tampil.
const FALLBACK = { width: 300, height: 600 }

export const JENIS_LABEL: Record<Jenis, string> = {
  dokumen: 'Dokumen', gambar: 'Gambar', audio: 'Audio', video: 'Video', kode: 'Kode', arsip: 'Arsip', lainnya: 'Lainnya'
}
const STATUS_LABEL: Record<AssetStatus, string> = { memproses: 'Memproses', siap: 'Siap', gagal: 'Gagal' }
const SORT_LABEL: Record<LibrarySort, string> = { terbaru: 'Terbaru', terlama: 'Terlama', nama: 'Nama A–Z', ukuran: 'Terbesar' }
const SCOPE_LABEL: Record<LibraryScope, string> = { semua: 'Semua aset', proyek: 'Proyek ini', 'belum-dipakai': 'Belum dipakai di board' }

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
const formatCount = (n: number): string => n.toLocaleString('id-ID')

function ItemView(props: { item: LibraryItem; selected: boolean; list: boolean }): React.JSX.Element {
  const { asset, jenis } = props.item
  return (
    <div
      className={`library-item${props.selected ? ' selected' : ''}`}
      draggable="true"
      title={asset.originalName}
      onClick={() => workspace.select({ kind: 'asset', assetId: asset.id })}
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      <div className="library-thumb">
        {asset.previewUrl ? <img src={asset.previewUrl} alt={asset.originalName} loading="lazy" draggable={false} /> : <span>{JENIS_LABEL[jenis]}</span>}
      </div>
      <div className="library-meta">
        <div className="library-name">{asset.originalName}</div>
        {asset.status === 'memproses' && <div className="library-status">Memproses…</div>}
        {asset.status === 'gagal' && <div className="library-status danger">Gagal ekstrak</div>}
        {props.list && props.item.snippet && <div className="search-snippet">{props.item.snippet}</div>}
      </div>
    </div>
  )
}

let searchInput: HTMLInputElement | null = null
export const libraryController = {
  focusSearch: (): void => {
    searchInput?.focus()
    searchInput?.select()
  }
}

export function LibraryPanel(): React.JSX.Element {
  const api = window.alfonso
  const projectId = useWorkspace((s) => s.activeProjectId)
  const libraryVersion = useWorkspace((s) => s.libraryVersion)
  const selection = useWorkspace((s) => s.selection)
  const selectedId = selection?.kind === 'asset' ? selection.assetId : null

  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [jenis, setJenis] = useState<Jenis[]>([])
  const [status, setStatus] = useState<AssetStatus[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [scope, setScope] = useState<LibraryScope>('semua')
  const [sort, setSort] = useState<LibrarySort>('terbaru')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [reloadKey, setReloadKey] = useState(0)
  const [allTags, setAllTags] = useState<TagCount[]>([])

  const [total, setTotal] = useState<number | null>(null)
  const [pages, setPages] = useState<Map<number, LibraryItem[]>>(new Map())
  const loading = useRef(new Set<number>())
  const generation = useRef(0)

  const scroller = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(FALLBACK)
  const [scrollTop, setScrollTop] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 150)
    return () => clearTimeout(t)
  }, [text])

  // Impor baru, status ekstraksi berubah → muat ulang (dijeda supaya drop 100 file tidak memicu 100 kueri).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = api.ingest.onEvent(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setReloadKey((k) => k + 1), 500)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [api])

  useEffect(() => {
    void api.library.tags().then(setAllTags, () => setAllTags([]))
  }, [api, libraryVersion, reloadKey])

  const baseQuery = useMemo((): LibraryQuery => {
    const out: LibraryQuery = { sort, scope }
    if (q) out.q = q
    if (jenis.length) out.jenis = jenis
    if (status.length) out.status = status
    if (tags.length) out.tags = tags
    if (scope === 'proyek' && projectId) out.projectId = projectId
    return out
  }, [q, jenis, status, tags, scope, sort, projectId])

  const loadPage = useCallback(
    (page: number, gen: number) => {
      if (loading.current.has(page)) return
      loading.current.add(page)
      api.library.query({ ...baseQuery, offset: page * PAGE, limit: PAGE }).then(
        (r) => {
          if (gen !== generation.current) return
          loading.current.delete(page)
          setTotal(r.total)
          setPages((m) => new Map(m).set(page, r.items))
        },
        () => {
          if (gen === generation.current) loading.current.delete(page)
        }
      )
    },
    [api, baseQuery]
  )

  // Kueri berubah atau isi Library berubah → mulai dari halaman pertama.
  useEffect(() => {
    if (scope === 'proyek' && !projectId) return
    generation.current++
    loading.current = new Set()
    setPages(new Map())
    loadPage(0, generation.current)
  }, [loadPage, libraryVersion, reloadKey, scope, projectId])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      if (el.clientWidth > 0 && el.clientHeight > 0) setSize({ width: el.clientWidth, height: el.clientHeight })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const count = total ?? 0
  const columns = view === 'grid' ? columnsFor(size.width, GRID.minWidth) : 1
  const rowHeight = view === 'grid' ? GRID.rowHeight : LIST.rowHeight
  const range = visibleRange({ count, columns, rowHeight, scrollTop, viewportHeight: size.height })

  // Halaman yang dibutuhkan baris terlihat tapi belum dimuat.
  useEffect(() => {
    if (range.endIndex <= range.startIndex) return
    for (let p = Math.floor(range.startIndex / PAGE); p <= Math.floor((range.endIndex - 1) / PAGE); p++) {
      if (!pages.has(p)) loadPage(p, generation.current)
    }
  }, [range.startIndex, range.endIndex, pages, loadPage])

  const filtered = q !== '' || jenis.length > 0 || status.length > 0 || tags.length > 0 || scope !== 'semua'
  const clearFilters = (): void => {
    setText('')
    setQ('')
    setJenis([])
    setStatus([])
    setTags([])
    setScope('semua')
  }

  const visible: { index: number; item: LibraryItem | undefined }[] = []
  for (let i = range.startIndex; i < range.endIndex; i++) visible.push({ index: i, item: pages.get(Math.floor(i / PAGE))?.[i % PAGE] })

  return (
    <div className="library-panel">
      <div className="library-toolbar">
        <input
          ref={(el) => {
            searchInput = el
          }}
          className="library-search"
          aria-label="Cari di Library" placeholder="Cari nama, tag, atau isi file…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="library-row">
          <select aria-label="Cakupan" value={scope} onChange={(e) => setScope(e.target.value as LibraryScope)}>
            {(Object.keys(SCOPE_LABEL) as LibraryScope[]).map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABEL[s]}
              </option>
            ))}
          </select>
          <select aria-label="Urutkan" value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)}>
            {(Object.keys(SORT_LABEL) as LibrarySort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
          <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
            Grid
          </button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
            Daftar
          </button>
        </div>
        <div className="library-chips">
          {JENIS.map((j) => (
            <button key={j} type="button" className="chip" aria-pressed={jenis.includes(j)} onClick={() => setJenis((l) => toggle(l, j))}>
              {JENIS_LABEL[j]}
            </button>
          ))}
        </div>
        <div className="library-chips">
          {(Object.keys(STATUS_LABEL) as AssetStatus[]).map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={status.includes(s)} onClick={() => setStatus((l) => toggle(l, s))}>
              {STATUS_LABEL[s]}
            </button>
          ))}
          <select
            aria-label="Saring tag"
            value=""
            onChange={(e) => {
              const v = e.target.value
              if (v) setTags((l) => (l.includes(v) ? l : [...l, v]))
            }}
          >
            <option value="">Tag…</option>
            {allTags
              .filter((t) => !tags.includes(t.tag))
              .map((t) => (
                <option key={t.tag} value={t.tag}>
                  {t.tag} ({t.count})
                </option>
              ))}
          </select>
          {tags.map((t) => (
            <span key={t} className="chip chip-tag">
              {t}
              <button type="button" aria-label={`Hapus tag ${t}`} onClick={() => setTags((l) => l.filter((x) => x !== t))}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="library-count">{total === null ? 'Memuat…' : `${formatCount(count)} aset`}</div>
      </div>
      <div className="library-scroll" ref={scroller} data-testid="library-scroll" onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}>
        {total === 0 &&
          (filtered ? (
            <div className="empty-state">
              <div className="empty-illustration" aria-hidden="true" />
              <p>Tidak ada yang cocok</p>
              <button type="button" onClick={clearFilters}>
                Hapus filter
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-illustration" aria-hidden="true" />
              <p>Library masih kosong. Drop file ke Board, tempel tautan, atau pantau folder lewat Ctrl+K.</p>
            </div>
          ))}
        <div style={{ height: range.totalHeight, position: 'relative' }}>
          <div
            data-testid="library-items"
            className={view === 'grid' ? 'library-items grid' : 'library-items list'}
            style={{ transform: `translateY(${range.offsetTop}px)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: rowHeight }}
          >
            {visible.map(({ index, item }) =>
              item ? (
                <ItemView key={item.asset.id} item={item} selected={item.asset.id === selectedId} list={view === 'list'} />
              ) : (
                <div key={`kosong-${index}`} className="library-item placeholder" />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
