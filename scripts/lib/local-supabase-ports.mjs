// ESM entry for scripts/lib/local-supabase-ports.cjs, which holds the implementation and
// says why it is CommonJS.
import ports from './local-supabase-ports.cjs'

export const {
  localSupabasePorts,
  localDatabaseUrl,
  localSupabaseApiUrl,
  localMailpitUrl,
  isLocalSupabaseDatabaseUrl,
} = ports
