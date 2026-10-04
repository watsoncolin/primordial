import { WORLD } from './config'
import { wrapDelta } from './math'
import type { Nutrients } from './nutrients'
import { glowSprite } from './sprites'
import type { Vent } from './vents'
import type { View } from './view'

const BUCKET = 128
const RANGE = 950
const REFRESH = 0.5
const MAX_SCENTS = 5
/** Minimum particles in a bucket for it to count as a cloud worth smelling. */
const CLOUD_MIN = 6
const EDGE_INSET = 30

interface Scent {
  x: number
  y: number
  /** 0..1 */
  strength: number
  sprite: HTMLCanvasElement
  rgb: string
}

/**
 * Chemoreception: off-screen food clouds and vents leave a trace at the matching edge of the screen.
 * It's deliberately vague (a glow and a chevron, no distances), like catching a scent in the water.
 */
export class Senses {
  private scents: Scent[] = []
  private timer = 0
  private readonly foodGlow = glowSprite(170, 255, 160)
  private readonly ventGlow = glowSprite(170, 170, 255)

  update(dt: number, px: number, py: number, nutrients: Nutrients, vents: Vent[]) {
    this.timer -= dt
    if (this.timer > 0) return
    this.timer = REFRESH

    // Bucket nearby food into a coarse grid and keep the dense cells.
    const buckets = new Map<number, { x: number; y: number; count: number; n: number }>()
    for (const n of nutrients.items) {
      if (n.kind === 'mineral' || n.fading) continue
      const dx = wrapDelta(n.x - px, WORLD)
      const dy = wrapDelta(n.y - py, WORLD)
      if (dx * dx + dy * dy > RANGE * RANGE) continue
      const key = Math.floor((dx + RANGE) / BUCKET) * 1000 + Math.floor((dy + RANGE) / BUCKET)
      const b = buckets.get(key) ?? { x: 0, y: 0, count: 0, n: 0 }
      b.x += dx
      b.y += dy
      b.count++
      // Lipids smell stronger: they're the valuable stuff.
      b.n += n.kind === 'lipid' ? 3 : 1
      buckets.set(key, b)
    }
    const found: (Scent & { d: number })[] = []
    for (const b of buckets.values()) {
      if (b.n < CLOUD_MIN) continue
      const x = b.x / b.count
      const y = b.y / b.count
      const d = Math.hypot(x, y)
      found.push({
        x: px + x,
        y: py + y,
        d,
        strength: Math.min(1, b.n / 30),
        sprite: this.foodGlow,
        rgb: '170,255,160',
      })
    }
    for (const v of vents) {
      const dx = wrapDelta(v.x - px, WORLD)
      const dy = wrapDelta(v.y - py, WORLD)
      const d = Math.hypot(dx, dy)
      if (d < RANGE * 1.2)
        found.push({ x: px + dx, y: py + dy, d, strength: 0.8, sprite: this.ventGlow, rgb: '170,180,255' })
    }
    // Strongest-and-nearest first.
    found.sort((a, b) => b.strength / (1 + b.d / 300) - a.strength / (1 + a.d / 300))
    this.scents = found.slice(0, MAX_SCENTS)
  }

  draw(ctx: CanvasRenderingContext2D, view: View, time: number) {
    const cx = view.w / 2
    const cy = view.h / 2
    for (const s of this.scents) {
      const sx = view.sx(s.x)
      const sy = view.sy(s.y)
      if (view.onScreen(sx, sy, -EDGE_INSET)) continue // visible already; no need to smell it
      const dx = sx - cx
      const dy = sy - cy
      const t = Math.min((cx - EDGE_INSET) / Math.abs(dx || 1e-6), (cy - EDGE_INSET) / Math.abs(dy || 1e-6))
      const ex = cx + dx * t
      const ey = cy + dy * t
      const d = Math.hypot(dx, dy) || 1
      const ux = dx / d
      const uy = dy / d
      const alpha = s.strength * (0.55 + 0.25 * Math.sin(time * 2 + s.x * 0.01))

      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = alpha * 0.6
      const size = 70 + 50 * s.strength
      ctx.drawImage(s.sprite, ex - size / 2, ey - size / 2, size, size)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'

      // A small chevron pointing outward, toward the source.
      const w = 7
      const back = 6
      ctx.beginPath()
      ctx.moveTo(ex - ux * back - uy * w, ey - uy * back + ux * w)
      ctx.lineTo(ex + ux * back, ey + uy * back)
      ctx.lineTo(ex - ux * back + uy * w, ey - uy * back - ux * w)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 2
      ctx.strokeStyle = `rgba(${s.rgb},${Math.min(1, alpha + 0.2)})`
      ctx.stroke()
    }
  }
}
