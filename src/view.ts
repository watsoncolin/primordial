import { WORLD } from './config'
import { wrapDelta } from './math'

/** Camera: world → screen (CSS pixels), wrap-aware. */
export class View {
  w = 0
  h = 0
  x = 0
  y = 0
  zoom = 1

  sx(wx: number) {
    return this.w / 2 + wrapDelta(wx - this.x, WORLD) * this.zoom
  }

  sy(wy: number) {
    return this.h / 2 + wrapDelta(wy - this.y, WORLD) * this.zoom
  }

  onScreen(sx: number, sy: number, margin: number) {
    return sx > -margin && sx < this.w + margin && sy > -margin && sy < this.h + margin
  }
}
