/**
 * `WARDROBE_MAINTENANCE_ENABLED=true` makes the dedicated wardrobe worker (`wardrobe.bootstrap.ts`)
 * the one consumer of the `maintenance` queue on its Redis, running only the wardrobe retention
 * purge and the deletion drain. BullMQ splits a queue's jobs across every worker subscribed to its
 * name, in any process, so a second consumer would take some of those jobs and run them with the
 * wrong processor or drop them. The general worker (`bootstrap.ts`) consumes the same queue with
 * every sweep, so it refuses to start where this variable names the wardrobe worker as the owner.
 */
export const WARDROBE_MAINTENANCE_ENV = 'WARDROBE_MAINTENANCE_ENABLED'

export function wardrobeMaintenanceEnabled(
  env: Readonly<NodeJS.ProcessEnv> = process.env
): boolean {
  return env[WARDROBE_MAINTENANCE_ENV]?.trim() === 'true'
}

/** Throws when this environment hands the maintenance queue to the dedicated wardrobe worker. */
export function assertGeneralWorkerMayConsumeMaintenance(
  env: Readonly<NodeJS.ProcessEnv> = process.env
): void {
  if (!wardrobeMaintenanceEnabled(env)) return
  throw new Error(
    `${WARDROBE_MAINTENANCE_ENV}=true makes the dedicated wardrobe worker the only consumer of the ` +
      'maintenance queue on this Redis, so the general worker must not start with it. Unset it ' +
      'here, or stop the wardrobe worker that owns maintenance.'
  )
}
