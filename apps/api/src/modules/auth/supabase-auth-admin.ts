import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { z } from 'zod'

/**
 * Story 6.17 D3: the one place the API deletes Supabase Auth users.
 *
 * Supabase creates an Auth user the moment a Google sign-in completes, before CoutureCast
 * knows the person's age. An under-13 refusal, a cancelled finish step and the orphan sweep
 * delete that user (and with it the Google name and avatar Supabase keeps in
 * `raw_user_meta_data`) through the Auth Admin API.
 *
 * The service role key is read per call and never logged. A missing key fails the call
 * (503) instead of the process, so environments that never reach this path still boot.
 */
export const SUPABASE_AUTH_ADMIN = 'SUPABASE_AUTH_ADMIN'

export type AuthAdminUser = {
  id: string
  email: string | null
  createdAt: string
  appMetadata: Record<string, unknown>
}

export type AuthAdminUserPage = {
  users: AuthAdminUser[]
  nextPage: number | null
}

const notFoundBodySchema = z.object({ error_code: z.literal('user_not_found') })

const ADMIN_TIMEOUT_MS = 5_000

const adminUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().nullish(),
  created_at: z.string(),
  app_metadata: z.record(z.unknown()).nullish(),
})

const adminUserPageSchema = z.object({
  users: z.array(adminUserSchema),
})

const adminUnavailable = () =>
  new ServiceUnavailableException('Account cleanup is unavailable.')

@Injectable()
export class SupabaseAuthAdmin {
  private config() {
    const url = process.env.SUPABASE_URL?.trim()
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    if (!url || !key) throw adminUnavailable()
    return { base: url.replace(/\/$/, ''), key }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const { base, key } = this.config()
    try {
      return await fetch(`${base}/auth/v1/admin${path}`, {
        ...init,
        headers: { apikey: key, authorization: `Bearer ${key}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(ADMIN_TIMEOUT_MS),
      })
    } catch {
      throw adminUnavailable()
    }
  }

  /**
   * Deletes the Auth user and its identities. An already-deleted user counts as done, but only
   * when Auth itself says so (`user_not_found`): a 404 from a wrong `SUPABASE_URL` is a failure.
   */
  async deleteUser(authUserId: string): Promise<void> {
    const response = await this.request(`/users/${encodeURIComponent(authUserId)}`, {
      method: 'DELETE',
    })
    if (response.ok) return
    if (response.status === 404) {
      const body: unknown = await response.json().catch(() => null)
      if (notFoundBodySchema.safeParse(body).success) return
    }
    throw adminUnavailable()
  }

  async listUsers({
    page,
    perPage,
  }: {
    page: number
    perPage: number
  }): Promise<AuthAdminUserPage> {
    const query = new URLSearchParams({ page: String(page), per_page: String(perPage) })
    const response = await this.request(`/users?${query.toString()}`, { method: 'GET' })
    if (!response.ok) throw adminUnavailable()
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw adminUnavailable()
    }
    const parsed = adminUserPageSchema.safeParse(body)
    if (!parsed.success) throw adminUnavailable()
    // Auth reports the total in X-Total-Count; a page shorter than asked is the last one too.
    // Only a plain count is trusted: an empty or malformed header falls back to the page length.
    const totalHeader = response.headers.get('x-total-count')?.trim() ?? ''
    const morePages = /^\d+$/.test(totalHeader)
      ? page * perPage < Number(totalHeader)
      : parsed.data.users.length >= perPage
    return {
      users: parsed.data.users.map((user) => ({
        id: user.id,
        email: user.email ?? null,
        createdAt: user.created_at,
        appMetadata: user.app_metadata ?? {},
      })),
      nextPage: morePages && parsed.data.users.length > 0 ? page + 1 : null,
    }
  }
}
