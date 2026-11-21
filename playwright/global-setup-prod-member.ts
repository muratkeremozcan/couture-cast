import {
  browserSessionOf,
  closeProdSyntheticMember,
  PROD_MEMBER_SESSION_ENV,
  signInProdSyntheticMember,
} from './support/helpers/prod-synthetic-member'

/** The GitHub workflow command belongs in runner setup. Worker stdout is a report attachment. */
export default async function setupProdMember() {
  if (process.env.GITHUB_ACTIONS !== 'true') return

  const member = await signInProdSyntheticMember()
  try {
    const escaped = member.accessToken
      .replaceAll('%', '%25')
      .replaceAll('\r', '%0D')
      .replaceAll('\n', '%0A')
    process.stdout.write(`::add-mask::${escaped}\n`)

    // Workers inherit the minimized session. The runner keeps the real refresh token private.
    process.env[PROD_MEMBER_SESSION_ENV] = JSON.stringify({
      ...member,
      session: browserSessionOf(member),
    })
  } catch (error) {
    await closeProdSyntheticMember(member)
    throw error
  }

  return async () => {
    delete process.env[PROD_MEMBER_SESSION_ENV]
    await closeProdSyntheticMember(member)
  }
}
