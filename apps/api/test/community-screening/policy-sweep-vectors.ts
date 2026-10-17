// Story 6.2b, AC 3: the deterministic vector set for the policy-surface sweep.
//
// Shared by the sweep spec and by the branch-coverage probe the spec runs in a
// child process, so both exercise exactly the same vectors. Nothing here is
// random: every vector is derived from the policy's own thresholds, so a policy
// change moves the boundaries the sweep probes along with it.

export interface SweepImagePolicy {
  classNames: readonly string[]
  safeClasses: readonly string[]
  safeMassMinimum: number
  reviewClasses: readonly string[]
  reviewClassMaximum: number
  unsafeAndReviewAggregateMaximum: number
  unsafeAggregateMaximum: number
  unsafeBlockMinimum: number
  unsafeClasses: readonly string[]
  probabilitySumTolerance: number
}

export interface SweepVector {
  /** Stable, human-readable family and position, so a failure names its input. */
  id: string
  family: SweepFamily
  probabilities: number[]
  classNames: string[]
}

export type SweepFamily =
  | 'simplex-grid'
  | 'threshold-boundary'
  | 'single-class-maximum'
  | 'uniform'
  | 'tie'
  | 'sum-tolerance'
  | 'non-finite'
  | 'out-of-range'
  | 'missing-class'
  | 'duplicated-class'
  | 'wrong-class-set'
  | 'permuted-class-order'
  | 'length-mismatch'
  | 'empty'

/** Grid resolution over the five-class simplex: every composition of 20 twentieths. */
export const SIMPLEX_STEPS = 20

/**
 * Offsets applied to each threshold. Large enough to clear float noise on the
 * outside and small enough to sit inside any plausible threshold change, with
 * zero for the boundary itself.
 */
export const BOUNDARY_OFFSETS = [-1e-3, -1e-6, -1e-9, 0, 1e-9, 1e-6, 1e-3] as const

function compositions(total: number, parts: number): number[][] {
  if (parts === 1) return [[total]]
  const out: number[][] = []
  for (let first = 0; first <= total; first += 1) {
    for (const rest of compositions(total - first, parts - 1)) {
      out.push([first, ...rest])
    }
  }
  return out
}

/** Builds a vector from named values, spreading the remainder over the fillers. */
function vectorFrom(
  policy: SweepImagePolicy,
  values: Readonly<Record<string, number>>,
  fillers: readonly string[]
): number[] {
  const assigned = Object.values(values).reduce((sum, value) => sum + value, 0)
  const remainder = Math.max(0, 1 - assigned)
  return policy.classNames.map((className) => {
    if (className in values) return values[className] as number
    return fillers.includes(className) ? remainder / fillers.length : 0
  })
}

/** A vector that publishes under the policy, used as a base for malformed variants. */
function publishableBase(policy: SweepImagePolicy): number[] {
  return vectorFrom(
    policy,
    {
      ...Object.fromEntries(policy.unsafeClasses.map((name) => [name, 0.002])),
      ...Object.fromEntries(policy.reviewClasses.map((name) => [name, 0.01])),
    },
    policy.safeClasses
  )
}

function simplexGrid(policy: SweepImagePolicy): SweepVector[] {
  return compositions(SIMPLEX_STEPS, policy.classNames.length).map((parts) => ({
    id: `simplex-grid:${parts.join('-')}`,
    family: 'simplex-grid',
    probabilities: parts.map((part) => part / SIMPLEX_STEPS),
    classNames: [...policy.classNames],
  }))
}

const signed = (offset: number) => `${offset >= 0 ? '+' : ''}${offset}`

/** The safe mass on both sides of its floor, split three ways across the safe classes. */
function safeMassBoundaries(policy: SweepImagePolicy, offset: number): SweepVector[] {
  const mass = policy.safeMassMinimum + offset
  // The rest goes to the unsafe and review classes inside their own bounds, so
  // the safe-mass comparison is the only one deciding.
  const rest = Math.max(0, 1 - mass)
  const unsafeShare = Math.min(rest * 0.4, policy.unsafeAggregateMaximum * 0.8)
  const reviewShare = rest - unsafeShare
  const nonSafe = {
    ...Object.fromEntries(
      policy.unsafeClasses.map((name) => [
        name,
        unsafeShare / policy.unsafeClasses.length,
      ])
    ),
    ...Object.fromEntries(
      policy.reviewClasses.map((name) => [
        name,
        reviewShare / policy.reviewClasses.length,
      ])
    ),
  }
  const splits: [string, number[]][] = [
    ['even', policy.safeClasses.map(() => 1 / policy.safeClasses.length)],
    ...policy.safeClasses.map(
      (_, index) =>
        [
          `all-${policy.safeClasses[index] as string}`,
          policy.safeClasses.map((__, position) => (position === index ? 1 : 0)),
        ] as [string, number[]]
    ),
  ]
  return splits.map(([label, split]) => ({
    id: `threshold-boundary:safe-mass-${label}${signed(offset)}`,
    family: 'threshold-boundary' as const,
    probabilities: vectorFrom(
      policy,
      {
        ...nonSafe,
        ...Object.fromEntries(
          policy.safeClasses.map((name, index) => [name, mass * (split[index] ?? 0)])
        ),
      },
      []
    ),
    classNames: [...policy.classNames],
  }))
}

function thresholdBoundaries(policy: SweepImagePolicy): SweepVector[] {
  const vectors: SweepVector[] = []
  const tiny = 0.001
  const unsafeTiny = Object.fromEntries(policy.unsafeClasses.map((name) => [name, tiny]))
  const reviewTiny = Object.fromEntries(policy.reviewClasses.map((name) => [name, tiny]))

  for (const offset of BOUNDARY_OFFSETS) {
    vectors.push(...safeMassBoundaries(policy, offset))

    // Each review class on both sides of its ceiling, everything else benign.
    for (const reviewClass of policy.reviewClasses) {
      vectors.push({
        id: `threshold-boundary:${reviewClass}-review${signed(offset)}`,
        family: 'threshold-boundary',
        probabilities: vectorFrom(
          policy,
          {
            ...unsafeTiny,
            ...reviewTiny,
            [reviewClass]: policy.reviewClassMaximum + offset,
          },
          policy.safeClasses
        ),
        classNames: [...policy.classNames],
      })
    }

    // The joint unsafe-and-review mass on both sides of its ceiling, each class
    // inside its own bound, so the joint comparison alone decides.
    const joint = policy.unsafeAndReviewAggregateMaximum + offset
    const perUnsafe = Math.min(
      policy.unsafeAggregateMaximum / (2 * policy.unsafeClasses.length),
      joint / (2 * policy.unsafeClasses.length)
    )
    const reviewMass = joint - perUnsafe * policy.unsafeClasses.length
    vectors.push({
      id: `threshold-boundary:joint${signed(offset)}`,
      family: 'threshold-boundary',
      probabilities: vectorFrom(
        policy,
        {
          ...Object.fromEntries(policy.unsafeClasses.map((name) => [name, perUnsafe])),
          ...Object.fromEntries(
            policy.reviewClasses.map((name) => [
              name,
              reviewMass / policy.reviewClasses.length,
            ])
          ),
        },
        policy.safeClasses
      ),
      classNames: [...policy.classNames],
    })

    // Each unsafe class on both sides of the block floor.
    for (const unsafe of policy.unsafeClasses) {
      vectors.push({
        id: `threshold-boundary:${unsafe}-block${signed(offset)}`,
        family: 'threshold-boundary',
        probabilities: vectorFrom(
          policy,
          { ...reviewTiny, [unsafe]: policy.unsafeBlockMinimum + offset },
          policy.safeClasses
        ),
        classNames: [...policy.classNames],
      })
    }

    // The unsafe aggregate on both sides of its ceiling, with a safe mass that
    // would otherwise publish, both concentrated in one class and split evenly.
    const aggregate = policy.unsafeAggregateMaximum + offset
    for (const [label, split] of [
      ['concentrated', [1, ...policy.unsafeClasses.slice(1).map(() => 0)]],
      ['even', policy.unsafeClasses.map(() => 1 / policy.unsafeClasses.length)],
    ] as const) {
      const unsafeValues = Object.fromEntries(
        policy.unsafeClasses.map((name, index) => [name, aggregate * (split[index] ?? 0)])
      )
      vectors.push({
        id: `threshold-boundary:aggregate-${label}${signed(offset)}`,
        family: 'threshold-boundary',
        probabilities: vectorFrom(
          policy,
          { ...reviewTiny, ...unsafeValues },
          policy.safeClasses
        ),
        classNames: [...policy.classNames],
      })
    }
  }
  return vectors
}

function singleClassMaxima(policy: SweepImagePolicy): SweepVector[] {
  const vectors: SweepVector[] = []
  for (const [index, className] of policy.classNames.entries()) {
    for (const peak of [1, 0.96, 0.6]) {
      const rest = (1 - peak) / (policy.classNames.length - 1)
      vectors.push({
        id: `single-class-maximum:${className}@${peak}`,
        family: 'single-class-maximum',
        probabilities: policy.classNames.map((_, position) =>
          position === index ? peak : rest
        ),
        classNames: [...policy.classNames],
      })
    }
  }
  return vectors
}

function uniformAndNearUniform(policy: SweepImagePolicy): SweepVector[] {
  const size = policy.classNames.length
  const base = 1 / size
  const vectors: SweepVector[] = [
    {
      id: 'uniform:exact',
      family: 'uniform',
      probabilities: policy.classNames.map(() => base),
      classNames: [...policy.classNames],
    },
  ]
  for (const delta of [1e-6, 1e-3, 0.02]) {
    for (let index = 0; index < size; index += 1) {
      const next = (index + 1) % size
      vectors.push({
        id: `uniform:near-${delta}-up${index}-down${next}`,
        family: 'uniform',
        probabilities: policy.classNames.map((_, position) =>
          position === index ? base + delta : position === next ? base - delta : base
        ),
        classNames: [...policy.classNames],
      })
    }
  }
  return vectors
}

/** A safe class and an unsafe one holding exactly the same probability. */
function ties(policy: SweepImagePolicy): SweepVector[] {
  const vectors: SweepVector[] = []
  const safe = policy.classNames.filter((name) => !policy.unsafeClasses.includes(name))
  for (const safeClass of safe) {
    for (const unsafe of policy.unsafeClasses) {
      for (const share of [0.5, 0.45, 0.35, 0.3, 0.05]) {
        const fillers = policy.classNames.filter(
          (name) => name !== safeClass && name !== unsafe
        )
        vectors.push({
          id: `tie:${safeClass}=${unsafe}@${share}`,
          family: 'tie',
          probabilities: vectorFrom(
            policy,
            { [safeClass]: share, [unsafe]: share },
            fillers
          ),
          classNames: [...policy.classNames],
        })
      }
    }
  }
  return vectors
}

/**
 * A publishable vector scaled so it sums just inside, exactly on, and just
 * outside the tolerance, on both sides of one.
 */
function sumTolerance(policy: SweepImagePolicy): SweepVector[] {
  const publishable = publishableBase(policy)
  const vectors: SweepVector[] = []
  for (const direction of [-1, 1]) {
    for (const offset of BOUNDARY_OFFSETS) {
      const target = 1 + direction * (policy.probabilitySumTolerance + offset)
      vectors.push({
        id: `sum-tolerance:${direction > 0 ? 'over' : 'under'}${offset >= 0 ? '+' : ''}${offset}`,
        family: 'sum-tolerance',
        probabilities: publishable.map((value) => value * target),
        classNames: [...policy.classNames],
      })
    }
  }
  return vectors
}

function malformedValues(policy: SweepImagePolicy): SweepVector[] {
  const publishable = publishableBase(policy)
  const vectors: SweepVector[] = []
  for (const [index, className] of policy.classNames.entries()) {
    for (const [label, value] of [
      ['NaN', Number.NaN],
      ['+Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
    ] as const) {
      vectors.push({
        id: `non-finite:${className}=${label}`,
        family: 'non-finite',
        probabilities: publishable.map((original, position) =>
          position === index ? value : original
        ),
        classNames: [...policy.classNames],
      })
    }
    for (const value of [-1e-12, -0.01, 1 + 1e-12, 1.01, 2]) {
      vectors.push({
        id: `out-of-range:${className}=${value}`,
        family: 'out-of-range',
        probabilities: publishable.map((original, position) =>
          position === index ? value : original
        ),
        classNames: [...policy.classNames],
      })
    }
  }
  return vectors
}

function malformedNames(policy: SweepImagePolicy): SweepVector[] {
  const publishable = publishableBase(policy)
  const vectors: SweepVector[] = []
  const names = [...policy.classNames]

  for (const [index, className] of names.entries()) {
    // Missing: the class and its probability both absent, so the lengths agree.
    vectors.push({
      id: `missing-class:${className}`,
      family: 'missing-class',
      probabilities: publishable.filter((_, position) => position !== index),
      classNames: names.filter((_, position) => position !== index),
    })
    // Duplicated: another position relabelled with this name.
    for (const [other, displaced] of names.entries()) {
      if (other === index) continue
      vectors.push({
        id: `duplicated-class:${className}-over-${displaced}`,
        family: 'duplicated-class',
        probabilities: [...publishable],
        classNames: names.map((name, position) =>
          position === other ? className : name
        ),
      })
    }
    // Wrong set: the class renamed to something the policy does not know.
    for (const replacement of [className.toLowerCase(), `${className}_v2`, 'Unknown']) {
      vectors.push({
        id: `wrong-class-set:${className}->${replacement}`,
        family: 'wrong-class-set',
        probabilities: [...publishable],
        classNames: names.map((name, position) =>
          position === index ? replacement : name
        ),
      })
    }
  }

  // A valid set in another order is not malformed: names travel with their
  // probabilities, so a rotated pairing must reach the same disposition.
  for (let shift = 1; shift < names.length; shift += 1) {
    const rotate = <T>(values: readonly T[]) => [
      ...values.slice(shift),
      ...values.slice(0, shift),
    ]
    vectors.push({
      id: `permuted-class-order:rotate-${shift}`,
      family: 'permuted-class-order',
      probabilities: rotate(publishable),
      classNames: rotate(names),
    })
  }

  vectors.push(
    {
      id: 'length-mismatch:extra-probability',
      family: 'length-mismatch',
      probabilities: [...publishable, 0],
      classNames: [...names],
    },
    {
      id: 'length-mismatch:extra-class',
      family: 'length-mismatch',
      probabilities: [...publishable],
      classNames: [...names, 'Extra'],
    },
    {
      id: 'empty:no-probabilities',
      family: 'empty',
      probabilities: [],
      classNames: [...names],
    },
    {
      id: 'empty:no-probabilities-no-classes',
      family: 'empty',
      probabilities: [],
      classNames: [],
    }
  )
  return vectors
}

/** Every vector the sweep evaluates, in a fixed order. */
export function buildPolicySweep(policy: SweepImagePolicy): SweepVector[] {
  return [
    ...simplexGrid(policy),
    ...thresholdBoundaries(policy),
    ...singleClassMaxima(policy),
    ...uniformAndNearUniform(policy),
    ...ties(policy),
    ...sumTolerance(policy),
    ...malformedValues(policy),
    ...malformedNames(policy),
  ]
}
