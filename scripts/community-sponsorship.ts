// Story 6.7b: the owner's audited operator command for community sponsorship
// links. Run it as `npm run community:sponsorship -- link|end ...`; the logic and
// its tests live in apps/api/src/modules/commerce/community-sponsorship.cli.ts.
import { runCommunitySponsorshipCli } from '../apps/api/src/modules/commerce/community-sponsorship.cli.js'

runCommunitySponsorshipCli(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    process.stderr.write(
      `community:sponsorship failed: ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  }
)
