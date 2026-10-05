/** A ram needs a frontal approach and real forward motion, not an enemy bump. */
export function ramImpact(closing: number, forward: number, alignment: number, recovering: boolean): number {
  if (recovering || closing < 45 || forward < 35 || alignment < 0.65) return 0
  return Math.min(1, closing / 100)
}
