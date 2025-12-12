import { runBurnIn } from '@seontechnologies/playwright-utils/burn-in'

async function main() {
  const args = process.argv.slice(2)
  const baseArg = args.find((arg) => arg.startsWith('--base-branch='))
  const shardArg = args.find((arg) => arg.startsWith('--shard='))
  const configArg = args.find((arg) => arg.startsWith('--config-path='))

  const options: Parameters<typeof runBurnIn>[0] = {
    configPath: configArg
      ? configArg.split('=')[1]
      : 'playwright/config/.burn-in.config.ts',
  }

  if (baseArg) {
    options.baseBranch = baseArg.split('=')[1]
  }

  if (shardArg) {
    process.env.PW_SHARD = shardArg.split('=')[1]
  }

  await runBurnIn(options)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
