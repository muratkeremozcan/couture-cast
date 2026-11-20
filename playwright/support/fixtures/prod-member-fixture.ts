// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// `prodMember`: the production synthetic member. CI signs in once per shard in global setup.
// A local production invocation signs in and out per worker. Outside production the fixture is
// null, so a spec skips with `test.skip(!prodMember, ...)` and keeps its fixture-bearer coverage
// on local and preview. Production sign-in failure fails the run.
//
// A trace, a video or a screenshot of a member session would record its bearer, and the artifacts
// of a public repository are public. Every spec on this `test` therefore runs with them off, and
// fails if a `test.use` turns one back on.
import {
  closeProdSyntheticMember,
  prodMemberFromRunner,
  signInProdSyntheticMember,
  type ProdSyntheticMember,
} from '../helpers/prod-synthetic-member'
import { expect, test as base } from './merged-fixtures'

export const test = base.extend<
  { memberArtifactsOff: undefined },
  { prodMember: ProdSyntheticMember | null }
>({
  // Plain values: the fixtures stop reading the project's configured mode.
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  memberArtifactsOff: [
    async ({ trace, video, screenshot }, use) => {
      const mode = (option: unknown) =>
        typeof option === 'object' && option !== null
          ? (option as { mode?: string }).mode
          : option
      for (const [name, option] of Object.entries({ trace, video, screenshot }))
        if (mode(option) !== 'off')
          throw new Error(
            `A production member spec must keep ${name} off: it would record the bearer.`
          )
      await use(undefined)
    },
    { auto: true },
  ],
  prodMember: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      if (workerInfo.project.metadata?.environment !== 'prod') {
        await use(null)
        return
      }
      if (process.env.GITHUB_ACTIONS === 'true') {
        await use(prodMemberFromRunner())
        return
      }
      const member = await signInProdSyntheticMember()
      try {
        await use(member)
      } finally {
        await closeProdSyntheticMember(member)
      }
    },
    { scope: 'worker' },
  ],
})

export { expect }
