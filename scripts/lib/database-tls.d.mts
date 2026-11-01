export declare const DATABASE_CA_PATH: string
export declare const LOCAL_DATABASE_HOSTS: ReadonlySet<string>
export declare class DatabaseTlsRefusedError extends Error {
  constructor(reason: string)
}
export declare function withVerifiedDatabaseTls(
  raw: string,
  options?: { caPath?: string; fileExists?: (candidate: string) => boolean }
): string
