import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, applyEdgeChanges, applyNodeChanges, useReactFlow,
  type Connection, type Edge, type EdgeChange, type NodeChange, type Viewport as FlowViewport
} from '@xyflow/react'
import type { CardDTO, IngestEvent, Viewport } from '../../shared/board-types'
import { cardToNode, createSaveScheduler, linkToEdge, nodeToCardPatch, selectionFromCards, studioRequestFromCard, FLOW_PROPS, type CardNode } from './mapping'
import { studioStore } from '../studio/studio-store'
import { nodeTypes } from './cards/CardNode'
import { ASSET_DRAG_TYPE } from '../library/LibraryPanel'
import { useWorkspace, workspace } from '../workspace'

export interface BoardController {
  addNote(): void
  focusCard(id: string): void
  /** Kartu baru di tengah layar yang menunjuk ke aset yang sudah ada (tombol "Tambahkan ke Board"). */
  addAsset(assetId: string): void
  removeCards(ids: string[]): void
}

// Palette, Library, dan Inspector (di luar React Flow) memanggil Board lewat pengendali ini.
let controller: BoardController | null = null
export const boardController = {
  addNote: (): void => controller?.addNote(),
  focusCard: (id: string): void => controller?.focusCard(id),
  addAsset: (assetId: string): void => controller?.addAsset(assetId),
  removeCards: (ids: string[]): void => controller?.removeCards(ids)
}

const PASTE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

function isTextInput(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

function BoardInner(props: { initial: { id: string; nodes: CardNode[]; edges: Edge[]; viewport: Viewport | null } }): React.JSX.Element {
  const boardId = props.initial.id
  const api = window.alfonso
  const flow = useReactFlow()
  const wrapper = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<CardNode[]>(props.initial.nodes)
  const [edges, setEdges] = useState<Edge[]>(props.initial.edges)
  const [message, setMessage] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; card: CardDTO } | null>(null)
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduler = useMemo(() => createSaveScheduler((p) => void api.board.saveCards(p), 2000), [api])

  const showMessage = useCallback((m: string) => {
    setMessage(m)
    setTimeout(() => setMessage((cur) => (cur === m ? null : cur)), 4000)
  }, [])

  const addCards = useCallback((cards: CardDTO[]) => {
    setNodes((ns) => [...ns, ...cards.filter((c) => !ns.some((n) => n.id === c.id)).map(cardToNode)])
  }, [])

  const centerPosition = useCallback(() => {
    const r = wrapper.current?.getBoundingClientRect()
    return flow.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 0) / 2, y: (r?.top ?? 0) + (r?.height ?? 0) / 2 })
  }, [flow])

  const removeCards = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      void api.board.deleteCards(ids)
      // Aset kartu yang dihapus bisa jadi "belum dipakai" di Library.
      workspace.bumpLibrary()
    },
    [api]
  )

  useEffect(() => {
    controller = {
      addNote: () => void api.board.createNote(centerPosition()).then((c) => addCards([c])),
      focusCard: (id) => void flow.fitView({ nodes: [{ id }], maxZoom: 1, duration: 200 }),
      addAsset: (assetId) =>
        void api.board.addAssetCard(assetId, centerPosition()).then((c) => {
          addCards([c])
          workspace.bumpLibrary()
        }, (err: Error) => showMessage(err.message)),
      removeCards: (ids) => {
        setNodes((ns) => ns.filter((n) => !ids.includes(n.id)))
        removeCards(ids)
      }
    }
    return () => {
      controller = null
    }
  }, [api, flow, centerPosition, addCards, removeCards, showMessage])

  // Permintaan fokus (dari pencarian atau Inspector "Dipakai di") untuk kartu di board ini.
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  useEffect(() => {
    const tryFocus = (): void => {
      const id = workspace.peekFocus()
      if (!id || !nodesRef.current.some((n) => n.id === id)) return
      workspace.takeFocus()
      // Ditunda satu frame supaya ukuran node baru sudah terukur.
      requestAnimationFrame(() => void flow.fitView({ nodes: [{ id }], maxZoom: 1, duration: 200 }))
    }
    tryFocus()
    return workspace.subscribe(tryFocus)
  }, [flow])

  // Status ekstraksi berubah → kartu yang menunjuk asset itu diperbarui; kartu baru (isi ZIP) ditambahkan.
  useEffect(
    () =>
      api.ingest.onEvent((e: IngestEvent) => {
        const updated = new Map((e.updatedCards ?? []).map((c) => [c.id, c]))
        setNodes((ns) => [
          ...ns.map((n) => {
            const u = updated.get(n.id)
            // Hanya isi kartu yang diganti; posisi dan ukuran tetap milik Board.
            if (u) return { ...n, data: { card: { ...n.data.card, assetId: u.assetId, asset: u.asset, style: u.style } } }
            if (e.asset && n.data.card.assetId === e.asset.id) return { ...n, data: { card: { ...n.data.card, asset: e.asset } } }
            return n
          }),
          // Kartu baru bisa untuk board lain (mis. hasil generate yang dimulai di board sebelumnya).
          ...e.newCards.filter((c) => c.boardId === boardId && !ns.some((n) => n.id === c.id)).map(cardToNode)
        ])
        if (e.newLinks?.length) {
          const ids = new Set(e.newCards.filter((c) => c.boardId === boardId).map((c) => c.id))
          const fresh = e.newLinks.filter((l) => ids.has(l.toId))
          if (fresh.length) setEdges((es) => [...es, ...fresh.filter((l) => !es.some((x) => x.id === l.id)).map(linkToEdge)])
        }
      }),
    [api, boardId]
  )

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: CardNode) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, card: node.data.card })
  }, [])

  useEffect(() => {
    const flush = (): void => scheduler.flush()
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      flush()
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [scheduler])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (isTextInput(e.target)) return
      const image = Array.from(e.clipboardData?.files ?? []).find((f) => PASTE_IMAGE_TYPES.includes(f.type))
      if (image) {
        e.preventDefault()
        const at = centerPosition()
        image
          .arrayBuffer()
          .then((buf) => api.ingest.pasteImage(buf, image.type, at))
          .then(addCards, (err: Error) => showMessage(err.message))
        return
      }
      const text = e.clipboardData?.getData('text/plain')?.trim()
      if (!text) return
      e.preventDefault()
      api.ingest.pasteText(text, centerPosition()).then((c) => addCards([c]), (err: Error) => showMessage(err.message))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [api, centerPosition, addCards, showMessage])

  const onNodesChange = useCallback(
    (changes: NodeChange<CardNode>[]) => {
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id)
      removeCards(removed)
      setNodes((ns) => applyNodeChanges(changes, ns))
    },
    [removeCards]
  )

  const onSelectionChange = useCallback(({ nodes: selected }: { nodes: CardNode[] }) => {
    const next = selectionFromCards(selected.map((n) => n.data.card), workspace.get().selection)
    if (JSON.stringify(next) !== JSON.stringify(workspace.get().selection)) workspace.select(next)
  }, [])

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) if (c.type === 'remove') void api.board.unlink(c.id)
      setEdges((es) => applyEdgeChanges(changes, es))
    },
    [api]
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return
      void api.board.link(c.source, c.target).then((link) => setEdges((es) => [...es, linkToEdge(link)]))
    },
    [api]
  )

  const onNodeDragStop = useCallback(
    (_e: MouseEvent | TouchEvent, _node: CardNode, dragged: CardNode[]) => {
      for (const n of dragged) scheduler.push(nodeToCardPatch(n))
    },
    [scheduler]
  )

  const onMoveEnd = useCallback(
    (_e: MouseEvent | TouchEvent | null, v: FlowViewport) => {
      if (viewportTimer.current) clearTimeout(viewportTimer.current)
      viewportTimer.current = setTimeout(() => void api.board.saveViewport({ x: v.x, y: v.y, zoom: v.zoom }, boardId), 1000)
    },
    [api, boardId]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      // Aset dari Library: kartu baru menunjuk ke aset yang sama, file tidak disalin ulang.
      if (Array.from(e.dataTransfer.types ?? []).includes(ASSET_DRAG_TYPE)) {
        const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE)
        if (assetId)
          api.board.addAssetCard(assetId, at).then((c) => {
            addCards([c])
            workspace.bumpLibrary()
          }, (err: Error) => showMessage(err.message))
        return
      }
      const files = Array.from(e.dataTransfer.files)
      if (files.length === 0) return
      api.ingest.dropFiles(files, at).then(addCards, (err: Error) => showMessage(err.message))
    },
    [api, flow, addCards, showMessage]
  )

  return (
    <div
      className="board"
      ref={wrapper}
      onDragOver={(e) => {
        e.preventDefault()
        if (Array.from(e.dataTransfer.types ?? []).includes(ASSET_DRAG_TYPE)) e.dataTransfer.dropEffect = 'copy'
      }} onDrop={onDrop} data-testid="board">
      <ReactFlow
        {...FLOW_PROPS}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onMoveEnd={onMoveEnd}
        onSelectionChange={onSelectionChange}
        onNodeContextMenu={onNodeContextMenu}
        defaultViewport={props.initial.viewport ?? { x: 0, y: 0, zoom: 1 }}
      />
      {nodes.length === 0 && <div className="board-empty">Drop file ke sini, tempel teks atau tautan, atau tekan Ctrl+K → Tambah catatan.</div>}
      {message && <div className="board-toast" role="status">{message}</div>}
      {menu && (
        <div className="card-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              studioStore.open(studioRequestFromCard(menu.card))
              setMenu(null)
            }}
          >
            Generate dari ini
          </button>
        </div>
      )}
    </div>
  )
}

export function Board(): React.JSX.Element {
  const activeBoardId = useWorkspace((s) => s.activeBoardId)
  const [initial, setInitial] = useState<{ id: string; nodes: CardNode[]; edges: Edge[]; viewport: Viewport | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadedId = initial?.id ?? null

  // Board aktif berubah (panel Proyek, Inspector "Dipakai di") → muat board itu.
  useEffect(() => {
    if (activeBoardId !== null && activeBoardId === loadedId) return
    let cancelled = false
    window.alfonso.board.open(activeBoardId ?? undefined).then(
      (b) => {
        if (cancelled) return
        setInitial({ id: b.id, nodes: b.cards.map(cardToNode), edges: b.links.map(linkToEdge), viewport: b.viewport })
        workspace.setActiveBoard(b.id, b.projectId)
      },
      (err: Error) => !cancelled && setError(err.message)
    )
    return () => {
      cancelled = true
    }
  }, [activeBoardId, loadedId])

  if (error) return <div className="panel-placeholder">Board gagal dimuat: {error}</div>
  if (!initial) return <div className="panel-placeholder">Memuat Board…</div>
  return (
    <ReactFlowProvider key={initial.id}>
      <BoardInner initial={initial} />
    </ReactFlowProvider>
  )
}
