export const TAU = Math.PI * 2

/** Shortest signed distance on a wrapping axis of length `size`. */
export const wrapDelta = (d: number, size: number) => d - size * Math.round(d / size)

export const wrapCoord = (x: number, size: number) => ((x % size) + size) % size

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x)

export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo)

/** Standard normal sample (Box–Muller). */
export function gauss() {
  let u = 0
  while (u === 0) u = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * Math.random())
}
