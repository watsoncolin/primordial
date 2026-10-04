import { WORLD } from './config'
import type { Fluid } from './fluid'
import { TAU, rand, wrapDelta } from './math'
import { MAX_MINERALS, type Nutrients } from './nutrients'
import { glowSprite } from './sprites'
import type { View } from './view'

const SHAPE_POINTS = 16

interface Body {
  x: number
  y: number
  vx: number
  vy: number
}

/** A rocky hydrothermal vent: solid, stirs a slow vortex, and sheds mineral crystals. */
export class Vent {
  readonly x: number
  readonly y: number
  readonly r: number
  private readonly shape: number[] = []
  private readonly spin = Math.random() < 0.5 ? -1 : 1
  private readonly seed = rand(0, 100)
  private timer = rand(0, 1)
  private static glow: HTMLCanvasElement | undefined

  constructor(x: number, y: number, r: number) {
    this.x = x
    this.y = y
    this.r = r
    for (let i = 0; i < SHAPE_POINTS; i++) this.shape.push(rand(0.85, 1.1))
  }

  step(dt: number, fluid: Fluid, nutrients: Nutrients) {
    fluid.swirl(this.x, this.y, this.r * 3, 6, 10 * this.spin)
    this.timer -= dt
    if (this.timer > 0) return
    this.timer = rand(0.6, 1.8)
    if (nutrients.count.mineral >= MAX_MINERALS || nutrients.near(this.x, this.y, this.r * 4, 'mineral') >= 22) return
    const a = rand(0, TAU)
    const s = rand(20, 45)
    nutrients.spawn(
      'mineral',
      this.x + Math.cos(a) * this.r * 1.1,
      this.y + Math.sin(a) * this.r * 1.1,
      Math.cos(a) * s,
      Math.sin(a) * s,
    )
  }

  /** Keep a body outside the rock, killing its inward velocity. */
  pushOut(o: Body, pad: number) {
    const min = this.r * 0.95 + pad
    const dx = wrapDelta(o.x - this.x, WORLD)
    if (dx > min || dx < -min) return
    const dy = wrapDelta(o.y - this.y, WORLD)
    const d2 = dx * dx + dy * dy
    if (d2 >= min * min) return
    const d = Math.sqrt(d2) || 0.001
    const nx = dx / d
    const ny = dy / d
    o.x += nx * (min - d)
    o.y += ny * (min - d)
    const vn = o.vx * nx + o.vy * ny
    if (vn < 0) {
      o.vx -= vn * nx * 1.2
      o.vy -= vn * ny * 1.2
    }
  }

  draw(ctx: CanvasRenderingContext2D, view: View, time: number) {
    const sx = view.sx(this.x)
    const sy = view.sy(this.y)
    const R = this.r * view.zoom
    if (!view.onScreen(sx, sy, R * 4)) return
    Vent.glow ??= glowSprite(255, 140, 60)

    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.28 + 0.08 * Math.sin(time * 1.3 + this.seed)
    ctx.drawImage(Vent.glow, sx - R * 3.5, sy - R * 3.5, R * 7, R * 7)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    const pts = this.shape.map((m, i) => {
      const a = (i / SHAPE_POINTS) * TAU
      return [sx + Math.cos(a) * R * m, sy + Math.sin(a) * R * m]
    })
    ctx.beginPath()
    const last = pts[pts.length - 1]
    ctx.moveTo((last[0] + pts[0][0]) / 2, (last[1] + pts[0][1]) / 2)
    for (let i = 0; i < pts.length; i++) {
      const next = pts[(i + 1) % pts.length]
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + next[0]) / 2, (pts[i][1] + next[1]) / 2)
    }
    ctx.closePath()
    const grad = ctx.createRadialGradient(sx, sy, R * 0.1, sx, sy, R * 1.1)
    grad.addColorStop(0, '#3a2418')
    grad.addColorStop(0.5, '#1d1512')
    grad.addColorStop(1, '#0e0b0a')
    ctx.fillStyle = grad
    ctx.fill()
    ctx.lineWidth = Math.max(1, R * 0.05)
    ctx.strokeStyle = 'rgba(255,150,90,0.25)'
    ctx.stroke()

    // Glowing mouth.
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.55 + 0.2 * Math.sin(time * 2.1 + this.seed)
    ctx.drawImage(Vent.glow, sx - R * 0.7, sy - R * 0.7, R * 1.4, R * 1.4)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
}

export function placeVents(): Vent[] {
  const spots = [
    [0.18, 0.28],
    [0.72, 0.18],
    [0.4, 0.78],
    [0.86, 0.66],
  ]
  return spots.map(
    ([fx, fy]) => new Vent((fx + rand(-0.05, 0.05)) * WORLD, (fy + rand(-0.05, 0.05)) * WORLD, rand(32, 48)),
  )
}
