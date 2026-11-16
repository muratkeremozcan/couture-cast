export const MOCK_OIDC_CONTAINER: string
export const MOCK_OIDC_FORWARDER_CONTAINER: string
export const MOCK_OIDC_PORT: number
export const MOCK_OIDC_URL: string
export function supabaseNetwork(projectId?: string): string
export function supabaseAuthContainer(projectId?: string): string
export function forwarderScript(target: string): string
export function mockOidcContainerArgs(options?: {
  network?: string
  authContainer?: string
}): [string[], string[]]
export function startMockOidcContainer(options?: {
  network?: string
  authContainer?: string
  timeoutMs?: number
}): Promise<{ close: () => Promise<void>; logs: () => Promise<string> }>
