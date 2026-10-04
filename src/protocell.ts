import { WORLD, tuning } from './config'
import type { Fluid } from './fluid'
import { TAU, rand } from './math'
import type { Kind } from './nutrients'
import { glowSprite } from './sprites'
import type { Vent } from './vents'
import type { View } from './view'

interface Body {
  x: number
  y: number
  vx: number
  vy: number
}

/** A particle floating in the cytoplasm. `r` is a fraction of the cell radius. */
interface Blob extends Body {
  r: number
  rgb: string
  life: number
  maxLife: number
  seed: number
}

const POINTS = 28
const INNER_RGB = ['255,214,170', '255,170,190', '200,240,255']
export const NUTRIENT_RGB: Record<Kind, string> = {
  organic: '170,255,160',
  lipid: '255,200,110',
  mineral: '170,180,255',
}

/**
 * The player: a ring of membrane points held in shape by shape-matching springs.
 * Drag is applied per point and is heavier on the side facing the flow, and thrust pushes
 * mostly from the rear, so the body flattens, stretches and wobbles as it swims.
 */
export class Protocell {
  readonly pts: Body[] = []
  readonly inner: Blob[] = []
  readonly digesting: Blob[] = []
  R: number
  targetR: number
  cx = 0
  cy = 0
  cvx = 0
  cvy = 0
  /** Thrust applied on the last step, used to drive the fluid jet. */
  thrust = 0

  private readonly restX = new Float32Array(POINTS)
  private readonly restY = new Float32Array(POINTS)
  private readonly nx = new Float32Array(POINTS)
  private readonly ny = new Float32Array(POINTS)
  private readonly weight = new Float32Array(POINTS)
  private readonly sx = new Float32Array(POINTS)
  private readonly sy = new Float32Array(POINTS)
  private readonly aura = glowSprite(110, 230, 210)
  private flash = 0

  constructor(x: number, y: number, r: number) {
    this.R = this.targetR = r
    for (let i = 0; i < POINTS; i++) {
      const a = (i / POINTS) * TAU
      this.restX[i] = Math.cos(a)
      this.restY[i] = Math.sin(a)
      this.pts.push({ x: x + this.restX[i] * r, y: y + this.restY[i] * r, vx: 0, vy: 0 })
    }
    for (const rgb of INNER_RGB) {
      this.inner.push({
        x: x + rand(-0.3, 0.3) * r,
        y: y + rand(-0.3, 0.3) * r,
        vx: 0,
        vy: 0,
        r: rand(0.14, 0.19),
        rgb,
        life: Infinity,
        maxLife: Infinity,
        seed: rand(0, 100),
      })
    }
    this.updateCentroid()
  }

  /** `ix, iy` is a unit steering direction, `mag` its 0..1 strength. */
  step(dt: number, fluid: Fluid, ix: number, iy: number, mag: number, time: number, vents: Vent[]) {
    this.R += (this.targetR - this.R) * Math.min(1, dt * 1.5)
    this.flash = Math.max(0, this.flash - dt * 2.5)
    this.updateCentroid()
    const { cx, cy, cvx, cvy, R, pts, restX, restY, nx, ny, weight } = this

    // Best-fit rotation of the rest circle onto the current points (2D shape matching),
    // so the body can be spun by shear in the current instead of snapping back upright.
    let num = 0
    let den = 0
    for (let i = 0; i < POINTS; i++) {
      const rx = pts[i].x - cx
      const ry = pts[i].y - cy
      num += restX[i] * ry - restY[i] * rx
      den += restX[i] * rx + restY[i] * ry
    }
    const rot = Math.atan2(num, den)
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)

    // Weak, rhythmic propulsion — a protocell squirms more than it swims.
    const pulse = 1 - tuning.pulse * (0.5 - 0.5 * Math.sin(time * tuning.pulseRate * TAU))
    const thrust = tuning.thrust * mag * pulse
    this.thrust = thrust

    let wsum = 0
    for (let i = 0; i < POINTS; i++) {
      nx[i] = restX[i] * cos - restY[i] * sin
      ny[i] = restX[i] * sin + restY[i] * cos
      weight[i] = 0.35 + Math.max(0, -(nx[i] * ix + ny[i] * iy))
      wsum += weight[i]
    }

    for (let i = 0; i < POINTS; i++) {
      const p = pts[i]
      const breathe = 1 + 0.03 * Math.sin(time * 1.7 + i * 0.9) + 0.015 * Math.sin(time * 3.1 - i * 2.3)
      let ax = tuning.stiffness * (cx + nx[i] * R * breathe - p.x) - tuning.wobbleDamping * (p.vx - cvx)
      let ay = tuning.stiffness * (cy + ny[i] * R * breathe - p.y) - tuning.wobbleDamping * (p.vy - cvy)

      // Drag against the surrounding water, sampled just outside the body so the cell's own wake
      // doesn't count. The side facing the oncoming flow takes most of it, which flattens the front.
      fluid.sample(cx + nx[i] * R * 1.6, cy + ny[i] * R * 1.6)
      const rvx = p.vx - fluid.su
      const rvy = p.vy - fluid.sv
      const rl = Math.hypot(rvx, rvy)
      const facing = rl > 1e-3 ? Math.max(0, (nx[i] * rvx + ny[i] * rvy) / rl) : 0
      const k = tuning.drag * (0.4 + tuning.frontDrag * facing)
      ax -= rvx * k
      ay -= rvy * k

      const share = (thrust * POINTS * weight[i]) / wsum
      ax += ix * share
      ay += iy * share

      p.vx += ax * dt
      p.vy += ay * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      for (const vent of vents) vent.pushOut(p, 0)
    }

    this.updateCentroid()
    for (const b of this.inner) this.stepBlob(b, dt, time)
    for (let i = this.digesting.length - 1; i >= 0; i--) {
      const b = this.digesting[i]
      b.life -= dt
      if (b.life <= 0) this.digesting.splice(i, 1)
      else this.stepBlob(b, dt, time)
    }
    this.separateBlobs()
    this.wrap()
  }

  /** Take in a particle: it keeps its momentum, gets digested, and dents the membrane where it entered. */
  ingest(kind: Kind, x: number, y: number, vx: number, vy: number) {
    if (this.digesting.length > 40) this.digesting.shift()
    const life = kind === 'organic' ? rand(0.8, 1.4) : rand(1.6, 2.6)
    this.digesting.push({
      x,
      y,
      vx,
      vy,
      r: kind === 'lipid' ? 0.09 : kind === 'mineral' ? 0.08 : 0.05,
      rgb: NUTRIENT_RGB[kind],
      life,
      maxLife: life,
      seed: rand(0, 100),
    })
    this.flash = Math.min(1, this.flash + 0.5)

    let nearest = 0
    let best = Infinity
    for (let i = 0; i < POINTS; i++) {
      const d = (this.pts[i].x - x) ** 2 + (this.pts[i].y - y) ** 2
      if (d < best) {
        best = d
        nearest = i
      }
    }
    for (const [offset, strength] of [
      [0, 1],
      [-1, 0.5],
      [1, 0.5],
    ]) {
      const p = this.pts[(nearest + offset + POINTS) % POINTS]
      const dx = p.x - this.cx
      const dy = p.y - this.cy
      const d = Math.hypot(dx, dy) || 1
      p.vx -= (dx / d) * this.R * 1.2 * strength
      p.vy -= (dy / d) * this.R * 1.2 * strength
    }
  }

  draw(ctx: CanvasRenderingContext2D, view: View) {
    const { sx, sy } = this
    for (let i = 0; i < POINTS; i++) {
      sx[i] = view.sx(this.pts[i].x)
      sy[i] = view.sy(this.pts[i].y)
    }
    const cx = view.sx(this.cx)
    const cy = view.sy(this.cy)
    const R = this.R * view.zoom

    // Smooth closed curve through the membrane points.
    const path = new Path2D()
    path.moveTo((sx[POINTS - 1] + sx[0]) / 2, (sy[POINTS - 1] + sy[0]) / 2)
    for (let i = 0; i < POINTS; i++) {
      const j = (i + 1) % POINTS
      path.quadraticCurveTo(sx[i], sy[i], (sx[i] + sx[j]) / 2, (sy[i] + sy[j]) / 2)
    }
    path.closePath()

    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.22 + this.flash * 0.15
    ctx.drawImage(this.aura, cx - R * 2.4, cy - R * 2.4, R * 4.8, R * 4.8)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R * 1.05)
    body.addColorStop(0, 'rgba(200,255,245,0.20)')
    body.addColorStop(0.6, 'rgba(90,200,190,0.10)')
    body.addColorStop(1, 'rgba(100,215,205,0.30)')
    ctx.fillStyle = body
    ctx.fill(path)

    ctx.save()
    ctx.clip(path)
    for (const b of this.inner) this.drawBlob(ctx, view, b, 0.9)
    for (const b of this.digesting) {
      const t = b.life / b.maxLife
      this.drawBlob(ctx, view, b, 0.85 * Math.min(1, t * 2), Math.sqrt(t))
    }
    ctx.restore()

    ctx.lineJoin = 'round'
    ctx.lineWidth = R * 0.2
    ctx.strokeStyle = `rgba(120,240,220,${0.08 + this.flash * 0.08})`
    ctx.stroke(path)
    ctx.lineWidth = Math.max(1.5, R * 0.055)
    ctx.strokeStyle = `rgba(175,255,235,${0.6 + this.flash * 0.3})`
    ctx.stroke(path)

    // Specular highlight.
    ctx.beginPath()
    ctx.arc(cx - R * 0.08, cy - R * 0.08, R * 0.7, Math.PI * 1.08, Math.PI * 1.42)
    ctx.lineCap = 'round'
    ctx.lineWidth = R * 0.07
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.stroke()
  }

  private drawBlob(ctx: CanvasRenderingContext2D, view: View, b: Blob, alpha: number, scale = 1) {
    const r = b.r * scale * this.R * view.zoom
    if (r < 0.3) return
    const x = view.sx(b.x)
    const y = view.sy(b.y)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${b.rgb},${alpha})`)
    g.addColorStop(0.6, `rgba(${b.rgb},${alpha * 0.6})`)
    g.addColorStop(1, `rgba(${b.rgb},0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fill()
  }

  /** Cytoplasm: blobs lag behind the cell's motion (so they slosh) and wander gently. */
  private stepBlob(b: Blob, dt: number, time: number) {
    const { cx, cy, cvx, cvy, R } = this
    b.vx += ((cvx - b.vx) * 2.2 + (cx - b.x) * 1.2 + Math.sin(time * 0.9 + b.seed) * R * 0.4) * dt
    b.vy += ((cvy - b.vy) * 2.2 + (cy - b.y) * 1.2 + Math.cos(time * 0.7 + b.seed * 1.3) * R * 0.4) * dt
    b.x += b.vx * dt
    b.y += b.vy * dt
    const dx = b.x - cx
    const dy = b.y - cy
    const d = Math.hypot(dx, dy)
    const max = R * (0.68 - b.r)
    if (d > max && d > 0) {
      const nx = dx / d
      const ny = dy / d
      b.x = cx + nx * max
      b.y = cy + ny * max
      const vn = (b.vx - cvx) * nx + (b.vy - cvy) * ny
      if (vn > 0) {
        b.vx -= vn * nx * 1.5
        b.vy -= vn * ny * 1.5
      }
    }
  }

  private separateBlobs() {
    const all = this.inner.length + this.digesting.length
    const get = (i: number) => (i < this.inner.length ? this.inner[i] : this.digesting[i - this.inner.length])
    for (let a = 0; a < all; a++) {
      const ba = get(a)
      for (let b = a + 1; b < all; b++) {
        const bb = get(b)
        const dx = bb.x - ba.x
        const dy = bb.y - ba.y
        const min = (ba.r + bb.r) * this.R
        const d2 = dx * dx + dy * dy
        if (d2 >= min * min) continue
        const d = Math.sqrt(d2) || 0.001
        const push = (min - d) * 0.5
        ba.x -= (dx / d) * push
        ba.y -= (dy / d) * push
        bb.x += (dx / d) * push
        bb.y += (dy / d) * push
      }
    }
  }

  private updateCentroid() {
    let x = 0
    let y = 0
    let vx = 0
    let vy = 0
    for (const p of this.pts) {
      x += p.x
      y += p.y
      vx += p.vx
      vy += p.vy
    }
    this.cx = x / POINTS
    this.cy = y / POINTS
    this.cvx = vx / POINTS
    this.cvy = vy / POINTS
  }

  /** Keep coordinates inside the torus so precision never drifts. */
  private wrap() {
    const shiftX = this.cx < 0 ? WORLD : this.cx >= WORLD ? -WORLD : 0
    const shiftY = this.cy < 0 ? WORLD : this.cy >= WORLD ? -WORLD : 0
    if (!shiftX && !shiftY) return
    for (const b of [...this.pts, ...this.inner, ...this.digesting]) {
      b.x += shiftX
      b.y += shiftY
    }
    this.cx += shiftX
    this.cy += shiftY
  }
}
