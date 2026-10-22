// Tiruan fitur browser yang dibutuhkan React Flow di jsdom (pola mockReactFlow dari reactflow.dev/learn/advanced-use/testing).
class ResizeObserver {
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) { this.callback = callback }
  observe(target: Element) {
    const el = target as HTMLElement
    const contentRect = { width: el.offsetWidth, height: el.offsetHeight, x: 0, y: 0, top: 0, left: 0, right: el.offsetWidth, bottom: el.offsetHeight }
    this.callback([{ target, contentRect } as unknown as ResizeObserverEntry], this as unknown as globalThis.ResizeObserver)
  }
  unobserve() {}
  disconnect() {}
}
class DOMMatrixReadOnly {
  m22: number
  constructor(transform: string) {
    const scale = transform?.match(/scale\(([1-9.])\)/)?.[1]
    this.m22 = scale !== undefined ? +scale : 1
  }
}
let done = false
export function mockReactFlow(): void {
  if (done) return
  done = true
  ;(globalThis as any).ResizeObserver = ResizeObserver
  ;(globalThis as any).DOMMatrixReadOnly = DOMMatrixReadOnly
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: { get() { return parseFloat(this.style.height) || 1 } },
    offsetWidth: { get() { return parseFloat(this.style.width) || 1 } }
  })
  ;(SVGElement.prototype as any).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 })
}
