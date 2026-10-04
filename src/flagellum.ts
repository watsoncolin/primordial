import type { Fluid } from './fluid'
import { TAU } from './math'

const SEGMENTS = 20
/** Tail length as a multiple of the cell radius. */
const LENGTH = 2.1
/** Seconds for a newly evolved tail to grow to full length. */
const GROW_TIME = 1.5

/**
 * A whip-like tail. The spine is a follow-the-leader chain hanging off the cell's rear: it trails
 * behind as the body moves and turns, and drifts a little with the water. The visible whip is a
 * travelling sine wave drawn on top of the spine, beating faster the harder you swim.
 * Thrust itself is applied by the cell (see Protocell.step); this is the body part and its look.
 */
export class Flagellum {
  readonly x = new Float32Array(SEGMENTS + 1)
  readonly y = new Float32Array(SEGMENTS + 1)
  /** 0..1 how hard it's beating, smoothed. */
  beat = 0
  /** 0..1 grown-in fraction. */
  growth = 0
  private phase = 0
  private initialised = false
  // Screen-space scratch for drawing.
  private readonly px = new Float32Array(SEGMENTS + 1)
  private readonly py = new Float32Array(SEGMENTS + 1)
  private readonly lx = new Float32Array(SEGMENTS + 1)
  private readonly ly = new Float32Array(SEGMENTS + 1)
  private readonly rx = new Float32Array(SEGMENTS + 1)
  private readonly ry = new Float32Array(SEGMENTS + 1)

  /** `mount` is the rear membrane point; `n` its outward normal (the direction the tail leaves the body). */
  step(dt: number, fluid: Fluid, mountX: number, mountY: number, nX: number, nY: number, R: number, effort: number) {
    this.growth = Math.min(1, this.growth + dt / GROW_TIME)
    this.beat += (effort - this.beat) * Math.min(1, dt * 4)
    this.phase += dt * TAU * (1.2 + 4.8 * this.beat)

    const seg = (R * LENGTH * this.growth) / SEGMENTS
    const { x, y } = this
    if (!this.initialised) {
      for (let i = 0; i <= SEGMENTS; i++) {
        x[i] = mountX + nX * seg * i
        y[i] = mountY + nY * seg * i
      }
      this.initialised = true
    }

    x[0] = mountX
    y[0] = mountY
    for (let i = 1; i <= SEGMENTS; i++) {
      // Drift with the water so the tail sways in currents.
      if (i % 2 === 0) fluid.sample(x[i], y[i])
      x[i] += fluid.su * dt * 0.5
      y[i] += fluid.sv * dt * 0.5

      // Bending stiffness: relax toward a straight continuation of the previous segment.
      // Stiff at the root (so it leaves the body cleanly), floppy at the tip.
      let dx = i === 1 ? nX : x[i - 1] - x[i - 2]
      let dy = i === 1 ? nY : y[i - 1] - y[i - 2]
      let d = Math.hypot(dx, dy) || 1
      const stiff = 0.35 - 0.25 * (i / SEGMENTS)
      x[i] += (x[i - 1] + (dx / d) * seg - x[i]) * stiff
      y[i] += (y[i - 1] + (dy / d) * seg - y[i]) * stiff

      // Inextensible: keep the segment length.
      dx = x[i] - x[i - 1]
      dy = y[i] - y[i - 1]
      d = Math.hypot(dx, dy) || 1
      x[i] = x[i - 1] + (dx / d) * seg
      y[i] = y[i - 1] + (dy / d) * seg
    }
  }

  /** A point two-thirds along the tail, where its push into the water is centred. */
  get jetX() {
    return this.x[Math.round(SEGMENTS * 0.66)]
  }

  get jetY() {
    return this.y[Math.round(SEGMENTS * 0.66)]
  }

  shift(dx: number, dy: number) {
    for (let i = 0; i <= SEGMENTS; i++) {
      this.x[i] += dx
      this.y[i] += dy
    }
  }

  /** Drawn relative to the cell centre (`cellX/Y` world, `sx/sy` screen) so it can't split across the seam. */
  draw(
    ctx: CanvasRenderingContext2D,
    cellX: number,
    cellY: number,
    sx: number,
    sy: number,
    zoom: number,
    R: number,
    rgb: string,
  ) {
    const { px, py, x, y } = this
    const seg = (R * LENGTH * this.growth) / SEGMENTS
    const amp = seg * (0.9 + 1.1 * this.beat)
    for (let i = 0; i <= SEGMENTS; i++) {
      // Perpendicular to the local spine direction.
      const a = Math.max(0, i - 1)
      const b = Math.min(SEGMENTS, i + 1)
      let tx = x[b] - x[a]
      let ty = y[b] - y[a]
      const tl = Math.hypot(tx, ty) || 1
      tx /= tl
      ty /= tl
      const t = i / SEGMENTS
      const wave = Math.sin(this.phase - i * 0.85) * amp * Math.pow(t, 0.8)
      px[i] = sx + (x[i] - cellX - ty * wave) * zoom
      py[i] = sy + (y[i] - cellY + tx * wave) * zoom
    }

    // Soft glow along the spine, then the tail itself as one tapering filled ribbon
    // (separate translucent strokes would bead where they overlap).
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(px[0], py[0])
    for (let i = 1; i <= SEGMENTS; i++) ctx.lineTo(px[i], py[i])
    ctx.lineWidth = R * 0.32 * zoom
    ctx.strokeStyle = `rgba(${rgb},0.07)`
    ctx.stroke()

    const { lx, ly, rx, ry } = this
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = Math.max(0, i - 1)
      const b = Math.min(SEGMENTS, i + 1)
      let nx = -(py[b] - py[a])
      let ny = px[b] - px[a]
      const nl = Math.hypot(nx, ny) || 1
      const half = Math.max(0.5, R * zoom * (0.075 - 0.065 * (i / SEGMENTS)))
      nx = (nx / nl) * half
      ny = (ny / nl) * half
      lx[i] = px[i] + nx
      ly[i] = py[i] + ny
      rx[i] = px[i] - nx
      ry[i] = py[i] - ny
    }
    ctx.beginPath()
    ctx.moveTo(lx[0], ly[0])
    for (let i = 1; i <= SEGMENTS; i++) ctx.lineTo(lx[i], ly[i])
    for (let i = SEGMENTS; i >= 0; i--) ctx.lineTo(rx[i], ry[i])
    ctx.closePath()
    const grad = ctx.createLinearGradient(px[0], py[0], px[SEGMENTS], py[SEGMENTS])
    grad.addColorStop(0, `rgba(${rgb},0.8)`)
    grad.addColorStop(1, `rgba(${rgb},0.35)`)
    ctx.fillStyle = grad
    ctx.fill()
  }
}
