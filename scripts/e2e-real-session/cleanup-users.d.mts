/** Type declarations for `cleanup-users.mjs`, for its unit tests under `playwright/`. */

export type DeleteUserResult = {
  status: 'deleted' | 'missing' | 'failed'
  reason?: string
}

export type CleanupSummary = {
  recorded: number
  deleted: number
  missing: number
  failed: { label: string; reason: string }[]
}

export type FindUserResult =
  | { status: 'found'; authUserId: string }
  | { status: 'absent' }
  | { status: 'failed'; reason?: string }

export declare function deleteRecordedUsers(options: {
  directory: string
  deleteUser: (authUserId: string) => Promise<DeleteUserResult>
  findUserByEmail?: (email: string) => Promise<FindUserResult>
}): Promise<CleanupSummary>

export declare function localAuthUsers(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
): {
  deleteUser(authUserId: string): Promise<DeleteUserResult>
  findUserByEmail(email: string): Promise<FindUserResult>
}
