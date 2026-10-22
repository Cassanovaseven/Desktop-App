import type { Edge, Node } from '@xyflow/react'
import type { CardDTO, CardPatch, LinkDTO } from '../../shared/board-types'

export type CardNode = Node<{ card: CardDTO }>

export const FLOW_PROPS = {
  onlyRenderVisibleElements: true,
  minZoom: 0.05,
  maxZoom: 4
} as const

export function cardToNode(card: CardDTO): CardNode {
  return {
    id: card.id,
    type: card.type,
    position: { x: card.x, y: card.y },
    data: { card },
    style: { width: card.w, height: card.h },
    zIndex: card.z
  }
}

export function nodeToCardPatch(node: Node): CardPatch {
  const style = (node.style ?? {}) as { width?: number; height?: number }
  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    w: node.measured?.width ?? style.width,
    h: node.measured?.height ?? style.height
  }
}

export function linkToEdge(link: LinkDTO): Edge {
  return { id: link.id, source: link.fromId, target: link.toId }
}

// Mengumpulkan perubahan posisi lalu menyimpannya sekaligus (spec 7: posisi disimpan otomatis tiap beberapa detik).
export function createSaveScheduler(save: (patches: CardPatch[]) => void, delayMs: number) {
  const pending = new Map<string, CardPatch>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (pending.size === 0) return
    const patches = [...pending.values()]
    pending.clear()
    save(patches)
  }
  return {
    push(p: CardPatch): void {
      pending.set(p.id, { ...pending.get(p.id), ...p })
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    },
    flush
  }
}
