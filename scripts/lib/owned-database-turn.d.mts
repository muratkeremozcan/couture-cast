export declare const OWNED_DATABASE_TURN_KEY: number
export interface OwnedDatabaseTurn {
  readonly held: 'none' | 'shared' | 'exclusive'
  share(): Promise<void>
  exclusive(): Promise<void>
  release(): Promise<void>
}
export declare function ownedDatabaseTurn(client: {
  query: (sql: string, values?: unknown[]) => Promise<unknown>
}): OwnedDatabaseTurn
