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

const DOUBLE_TAP_MS = 300
/** Touch joystick: drag this far (px) for full thrust; the base trails the finger beyond it. */
export const STICK_REACH = 64
const STICK_DEAD = 8

/**
 * Mouse: hold anywhere; direction and strength come from where you hold relative to the cell.
 * Touch: a floating joystick wherever your thumb lands, so you never have to reach across the
 * screen or cover your own cell. A second finger (or a quick double-tap) is Burst Jet.
 */
export class Input {
  /** Steering result from the last read(): unit direction and 0..1 strength. */
  readonly steer = { x: 0, y: 0, mag: 0 }
  used = false
  private canvas: HTMLCanvasElement
  private pointer: { x: number; y: number } | null = null
  /** The touch joystick: where the thumb landed (base, trailing past STICK_REACH) and where it is now. */
  stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null
  private readonly keys = new Set<string>()
  private lastTap = 0
  private dashQueued = false
  private strikeQueued = false
  private latchQueued = false
  /**
   * Sticky ("toggle") movement, for automated playtests: one input keeps you swimming until the
   * next. Arrows/WASD set a direction, Space releases thrust, a click sets a target, Escape cancels,
   * B is Burst Jet. Physics are unchanged; only how input is held.
   */
  sticky = new URLSearchParams(location.search).has('sticky')
  /** Sticky direction currently held, if any. */
  stickyDir: { x: number; y: number } | null = null
  /** A click waiting to be turned into a world target (screen px). */
  private pendingClick: { x: number; y: number } | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    canvas.tabIndex = 0
    canvas.addEventListener('pointerdown', e => {
      this.used = true
      if (this.sticky) {
        this.pendingClick = { x: e.clientX, y: e.clientY }
        this.stickyDir = null
        return
      }
      canvas.setPointerCapture(e.pointerId)
      // A quick second tap is the touch equivalent of Space.
      if (e.timeStamp - this.lastTap < DOUBLE_TAP_MS) this.dashQueued = true
      this.lastTap = e.timeStamp
      if (e.pointerType === 'touch') {
        // Another finger while steering: lunge, and keep steering with the first.
        if (this.stick) this.dashQueued = true
        else this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY }
        return
      }
      this.pointer = { x: e.clientX, y: e.clientY }
    })
    canvas.addEventListener('pointermove', e => {
      const st = this.stick
      if (st && e.pointerId === st.id) {
        st.x = e.clientX
        st.y = e.clientY
        const dx = st.x - st.ox
        const dy = st.y - st.oy
        const len = Math.hypot(dx, dy)
        if (len > STICK_REACH) {
          st.ox = st.x - (dx / len) * STICK_REACH
          st.oy = st.y - (dy / len) * STICK_REACH
        }
      } else if (this.pointer) this.pointer = { x: e.clientX, y: e.clientY }
    })
    const lift = (e: PointerEvent) => {
      if (this.stick?.id === e.pointerId) this.stick = null
      else this.pointer = null
    }
    canvas.addEventListener('pointerup', lift)
    canvas.addEventListener('pointercancel', lift)
    window.addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      const key = e.key.toLowerCase()
      if (!e.repeat && key === 'f') {
        this.strikeQueued = true
        e.preventDefault()
        return
      }
      if (!e.repeat && key === 'r') {
        this.latchQueued = true
        e.preventDefault()
        return
      }
      if (this.sticky) {
        if (key in KEYS) {
          const [x, y] = KEYS[key]
          this.stickyDir = { x, y }
          this.pendingClick = null
          this.stickyCleared = true
          this.used = true
          e.preventDefault()
        } else if (key === ' ' || key === 'escape') {
          this.stickyDir = null
          this.stickyCleared = true
          e.preventDefault()
        } else if (key === 'b' && !e.repeat) {
          this.dashQueued = true
        }
        return
      }
      if (key === ' ' && !e.repeat) {
        this.dashQueued = true
        e.preventDefault()
      }
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
      this.stick = null
      this.stickyDir = null
      this.pendingClick = null
      this.stickyCleared = true
      this.dashQueued = this.strikeQueued = this.latchQueued = false
    })
  }

  /** Forget any held pointer/keys, e.g. after a UI overlay took over. */
  release() {
    this.pointer = null
    this.stick = null
    this.keys.clear()
    this.dashQueued = false
    this.strikeQueued = this.latchQueued = false
    this.stickyDir = null
    this.pendingClick = null
    this.stickyCleared = true
    this.canvas.focus({ preventScroll: true })
  }

  /** Set when an arrow, Space or Escape should drop any click target (the caller clears it). */
  stickyCleared = false

  /** A click made in sticky mode, once. */
  takeClick() {
    const c = this.pendingClick
    this.pendingClick = null
    return c
  }

  /** An on-screen Burst button was pressed. */
  queueDash() {
    this.used = true
    this.dashQueued = true
  }

  queueStrike() {
    this.strikeQueued = true
  }
  queueLatch() {
    this.latchQueued = true
  }
  takeStrike() {
    const v = this.strikeQueued
    this.strikeQueued = false
    return v
  }
  takeLatch() {
    const v = this.latchQueued
    this.latchQueued = false
    return v
  }

  /** True once per Space press or double-tap. */
  takeDash() {
    const queued = this.dashQueued
    this.dashQueued = false
    return queued
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
    const st = this.stick
    if (st) {
      const dx = st.x - st.ox
      const dy = st.y - st.oy
      const len = Math.hypot(dx, dy)
      if (len > STICK_DEAD) {
        s.x = dx / len
        s.y = dy / len
        s.mag = clamp(len / STICK_REACH, 0.25, 1)
        return s
      }
    } else if (this.pointer) {
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
