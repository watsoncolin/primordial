import { TAU } from './math'
import type { View } from './view'

interface Ripple {
  x: number
  y: number
  age: number
  life: number
  rgb: string
}

/** A curved fragment of torn membrane. */
interface Shard {
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  spin: number
  len: number
  age: number
  life: number
  rgb: string
}

/** Small expanding rings where something gets absorbed, and membrane fragments when a cell ruptures. */
export class Effects {
  private ripples: Ripple[] = []
  private shards: Shard[] = []

  ripple(x: number, y: number, rgb: string, life = 0.5) {
    this.ripples.push({ x, y, age: 0, life, rgb })
  }

  shard(x: number, y: number, vx: number, vy: number, angle: number, len: number, rgb: string) {
    this.shards.push({ x, y, vx, vy, angle, spin: (Math.random() - 0.5) * 6, len, age: 0, life: 1.2, rgb })
  }

  clear() {
    this.ripples = []
    this.shards = []
  }

  step(dt: number) {
    for (const r of this.ripples) r.age += dt
    this.ripples = this.ripples.filter(r => r.age < r.life)
    const damp = Math.exp(-2.5 * dt)
    for (const s of this.shards) {
      s.age += dt
      s.vx *= damp
      s.vy *= damp
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.angle += s.spin * dt
    }
    this.shards = this.shards.filter(s => s.age < s.life)
  }

  draw(ctx: CanvasRenderingContext2D, view: View) {
    ctx.lineWidth = 1.25
    for (const r of this.ripples) {
      const t = r.age / r.life
      ctx.beginPath()
      ctx.arc(view.sx(r.x), view.sy(r.y), (2 + t * 10 * (r.life / 0.5)) * view.zoom, 0, TAU)
      ctx.strokeStyle = `rgba(${r.rgb},${(1 - t) * 0.6})`
      ctx.stroke()
    }
    ctx.lineCap = 'round'
    for (const s of this.shards) {
      const t = s.age / s.life
      ctx.beginPath()
      ctx.arc(view.sx(s.x), view.sy(s.y), s.len * view.zoom, s.angle, s.angle + 0.7)
      ctx.lineWidth = Math.max(1, 1.6 * view.zoom * (1 - t * 0.5))
      ctx.strokeStyle = `rgba(${s.rgb},${(1 - t) * 0.8})`
      ctx.stroke()
    }
  }
}
