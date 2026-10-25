export declare function requestedPermissionsFromDumpsys(
  dumpsysOutput: string,
  appId: string
): string[]

export declare function withExplicitLaunchPermissions(
  yamlText: string,
  permissions: readonly string[],
  label: string
): { text: string; rewritten: number }

export declare function prepareAndroidFlowTree(options: {
  sourceDir: string
  targetDir: string
  permissions: readonly string[]
  skip?: readonly string[]
}): { files: number; rewritten: number }

export declare function preparedFlowPath(
  flowPath: string,
  sourceDir: string,
  targetDir: string
): string
