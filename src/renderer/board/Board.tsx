import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, applyEdgeChanges, applyNodeChanges, useReactFlow,
  type Connection, type Edge, type EdgeChange, type NodeChange, type Viewport as FlowViewport
} from '@xyflow/react'
import type { CardDTO, IngestEvent, Viewport } from '../../shared/board-types'
import { cardToNode, createSaveScheduler, linkToEdge, nodeToCardPatch, FLOW_PROPS, type CardNode } from './mapping'
import { nodeTypes } from './cards/CardNode'

export interface BoardController {
  addNote(): void
  focusCard(id: string): void
}

// Palette (di luar React Flow) memanggil Board lewat pengendali ini.
let controller: BoardController | null = null
export const boardController = {
  addNote: (): void => controller?.addNote(),
  focusCard: (id: string): void => controller?.focusCard(id)
}

function isTextInput(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

function BoardInner(props: { initial: { nodes: CardNode[]; edges: Edge[]; viewport: Viewport | null } }): React.JSX.Element {
  const api = window.alfonso
  const flow = useReactFlow()
  const wrapper = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<CardNode[]>(props.initial.nodes)
  const [edges, setEdges] = useState<Edge[]>(props.initial.edges)
  const [message, setMessage] = useState<string | null>(null)
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

  useEffect(() => {
    controller = {
      addNote: () => void api.board.createNote(centerPosition()).then((c) => addCards([c])),
      focusCard: (id) => void flow.fitView({ nodes: [{ id }], maxZoom: 1, duration: 200 })
    }
    return () => {
      controller = null
    }
  }, [api, flow, centerPosition, addCards])

  // Status ekstraksi berubah → kartu yang menunjuk asset itu diperbarui; kartu baru (isi ZIP) ditambahkan.
  useEffect(
    () =>
      api.ingest.onEvent((e: IngestEvent) => {
        setNodes((ns) => [
          ...ns.map((n) => (n.data.card.assetId === e.asset.id ? { ...n, data: { card: { ...n.data.card, asset: e.asset } } } : n)),
          ...e.newCards.filter((c) => !ns.some((n) => n.id === c.id)).map(cardToNode)
        ])
      }),
    [api]
  )

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
      if (removed.length) void api.board.deleteCards(removed)
      setNodes((ns) => applyNodeChanges(changes, ns))
    },
    [api]
  )

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
      viewportTimer.current = setTimeout(() => void api.board.saveViewport({ x: v.x, y: v.y, zoom: v.zoom }), 1000)
    },
    [api]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files)
      if (files.length === 0) return
      const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      api.ingest.dropFiles(files, at).then(addCards, (err: Error) => showMessage(err.message))
    },
    [api, flow, addCards, showMessage]
  )

  return (
    <div className="board" ref={wrapper} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} data-testid="board">
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
        defaultViewport={props.initial.viewport ?? { x: 0, y: 0, zoom: 1 }}
      />
      {nodes.length === 0 && <div className="board-empty">Drop file ke sini, tempel teks atau tautan, atau tekan Ctrl+K → Tambah catatan.</div>}
      {message && <div className="board-toast" role="status">{message}</div>}
    </div>
  )
}

export function Board(): React.JSX.Element {
  const [initial, setInitial] = useState<{ nodes: CardNode[]; edges: Edge[]; viewport: Viewport | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.alfonso.board.open().then(
      (b) => setInitial({ nodes: b.cards.map(cardToNode), edges: b.links.map(linkToEdge), viewport: b.viewport }),
      (err: Error) => setError(err.message)
    )
  }, [])

  if (error) return <div className="panel-placeholder">Board gagal dimuat: {error}</div>
  if (!initial) return <div className="panel-placeholder">Memuat Board…</div>
  return (
    <ReactFlowProvider>
      <BoardInner initial={initial} />
    </ReactFlowProvider>
  )
}
