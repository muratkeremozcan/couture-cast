// Story 6.14: the owner's audited operator command for complimentary full access. Run it as
// `npm run access:complimentary -- grant|revoke|list ...`; the logic and its tests live in
// apps/api/src/modules/commerce/complimentary-access.cli.ts.
import { runComplimentaryAccessCli } from '../apps/api/src/modules/commerce/complimentary-access.cli.js'

runComplimentaryAccessCli(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    process.stderr.write(
      `access:complimentary failed: ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  }
)
