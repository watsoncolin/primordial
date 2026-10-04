import { TAU } from './math'
import type { View } from './view'

interface Ripple {
  x: number
  y: number
  age: number
  life: number
  rgb: string
}

/** Small expanding rings where something gets absorbed. */
export class Effects {
  private ripples: Ripple[] = []

  ripple(x: number, y: number, rgb: string) {
    this.ripples.push({ x, y, age: 0, life: 0.5, rgb })
  }

  step(dt: number) {
    for (const r of this.ripples) r.age += dt
    this.ripples = this.ripples.filter(r => r.age < r.life)
  }

  draw(ctx: CanvasRenderingContext2D, view: View) {
    ctx.lineWidth = 1.25
    for (const r of this.ripples) {
      const t = r.age / r.life
      ctx.beginPath()
      ctx.arc(view.sx(r.x), view.sy(r.y), (2 + t * 10) * view.zoom, 0, TAU)
      ctx.strokeStyle = `rgba(${r.rgb},${(1 - t) * 0.6})`
      ctx.stroke()
    }
  }
}
