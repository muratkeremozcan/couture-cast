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

export declare function deleteRecordedUsers(options: {
  directory: string
  deleteUser: (authUserId: string) => Promise<DeleteUserResult>
}): Promise<CleanupSummary>

export declare function localAuthUserDeleter(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
): (authUserId: string) => Promise<DeleteUserResult>
