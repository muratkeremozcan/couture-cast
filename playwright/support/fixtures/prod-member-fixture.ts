// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// `prodMember`: the production synthetic member, signed in once per worker and signed out when the
// worker ends. It is null outside the production run, so a spec skips there with
// `test.skip(!prodMember, ...)` and keeps its fixture-bearer coverage on local and preview.
// Member specs also turn traces off (`test.use({ trace: 'off' })`): a trace records the bearer.
import {
  isProdRun,
  signInProdSyntheticMember,
  signOutProdSyntheticMember,
  type ProdSyntheticMember,
} from '../helpers/prod-synthetic-member'
import { expect, test as base } from './merged-fixtures'

export const test = base.extend<object, { prodMember: ProdSyntheticMember | null }>({
  prodMember: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      if (!isProdRun()) {
        await use(null)
        return
      }
      const member = await signInProdSyntheticMember()
      await use(member)
      await signOutProdSyntheticMember(member)
    },
    { scope: 'worker' },
  ],
})

export { expect }
