export function allowsTestOnlySecrets(
  env: Readonly<NodeJS.ProcessEnv> = process.env
): boolean {
  return env.NODE_ENV === 'test' || (env.TEST_ENV ?? '').trim().toLowerCase() === 'local'
}
