/** Story 6.2b: the clean holdout gate is the Wilson 95% upper bound <= 1%. */
export const CLEAN_HOLDOUT_UPPER_BOUND_MAXIMUM = 0.01

/** Wilson score interval at 95% confidence, using the two-sided normal quantile. */
export function wilsonInterval(successes: number, trials: number): [number, number] {
  if (trials === 0) return [0, 1]
  const z = 1.959963984540054
  const proportion = successes / trials
  const denominator = 1 + (z * z) / trials
  const centre = (proportion + (z * z) / (2 * trials)) / denominator
  const half =
    (z *
      Math.sqrt(
        (proportion * (1 - proportion)) / trials + (z * z) / (4 * trials * trials)
      )) /
    denominator
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}

/** Sample-count minimums are asserted separately by the release evaluation. */
export function passesCleanHoldoutGate(withheld: number, total: number): boolean {
  if (
    !Number.isInteger(withheld) ||
    !Number.isInteger(total) ||
    total <= 0 ||
    withheld < 0 ||
    withheld > total
  ) {
    return false
  }
  return wilsonInterval(withheld, total)[1] <= CLEAN_HOLDOUT_UPPER_BOUND_MAXIMUM
}
