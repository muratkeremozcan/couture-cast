export const MOCK_OIDC_CONTAINER: string
export const MOCK_OIDC_INTERNAL_URL: string
export const MOCK_OIDC_PORT: number
export const MOCK_OIDC_PUBLIC_URL: string
export function supabaseNetwork(projectId?: string): string
export function startMockOidcContainer(options?: {
  network?: string
  timeoutMs?: number
}): Promise<{ close: () => Promise<void> }>
