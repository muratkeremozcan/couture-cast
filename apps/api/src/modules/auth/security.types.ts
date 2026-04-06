import type { Request } from 'express'

export const API_ROLES = ['guardian', 'teen', 'moderator', 'admin'] as const
export type ApiRole = (typeof API_ROLES)[number]

export interface RequestAuthContext {
  token: string
  userId: string
  role: ApiRole
}

export type AuthenticatedRequest = Request & {
  auth?: RequestAuthContext
}
