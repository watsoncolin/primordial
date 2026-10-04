import { clamp } from './math'

const KEYS: Record<string, [number, number]> = {
  w: [0, -1],
  arrowup: [0, -1],
  s: [0, 1],
  arrowdown: [0, 1],
  a: [-1, 0],
  arrowleft: [-1, 0],
  d: [1, 0],
  arrowright: [1, 0],
}

/** Touch/mouse: hold and drag anywhere; direction and strength come from where you hold relative to the cell. */
export class Input {
  /** Steering result from the last read(): unit direction and 0..1 strength. */
  readonly steer = { x: 0, y: 0, mag: 0 }
  used = false
  private pointer: { x: number; y: number } | null = null
  private readonly keys = new Set<string>()

  constructor(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId)
      this.pointer = { x: e.clientX, y: e.clientY }
      this.used = true
    })
    canvas.addEventListener('pointermove', e => {
      if (this.pointer) this.pointer = { x: e.clientX, y: e.clientY }
    })
    canvas.addEventListener('pointerup', () => (this.pointer = null))
    canvas.addEventListener('pointercancel', () => (this.pointer = null))
    window.addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement) return
      const key = e.key.toLowerCase()
      if (key in KEYS) {
        this.keys.add(key)
        this.used = true
        e.preventDefault()
      }
    })
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()))
    window.addEventListener('blur', () => {
      this.keys.clear()
      this.pointer = null
    })
  }

  /** Forget any held pointer/keys, e.g. after a UI overlay took over. */
  release() {
    this.pointer = null
    this.keys.clear()
  }

  read(cellX: number, cellY: number, cellScreenR: number) {
    const s = this.steer
    let x = 0
    let y = 0
    for (const key of this.keys) {
      x += KEYS[key][0]
      y += KEYS[key][1]
    }
    if (x || y) {
      const len = Math.hypot(x, y)
      s.x = x / len
      s.y = y / len
      s.mag = 1
      return s
    }
    if (this.pointer) {
      const dx = this.pointer.x - cellX
      const dy = this.pointer.y - cellY
      const len = Math.hypot(dx, dy)
      if (len > cellScreenR * 0.3) {
        s.x = dx / len
        s.y = dy / len
        s.mag = clamp(len / (cellScreenR * 3.5), 0.25, 1)
        return s
      }
    }
    s.x = s.y = s.mag = 0
    return s
  }
}
