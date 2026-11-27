import { useEffect, useReducer } from 'react'

const maxTimerMs = 2_147_483_647

/** Re-render private media at its deadline and discard the timer when its view leaves. */
export function usePhotoBeforeExpiry(expiresAt: number | undefined): boolean {
  const [, refresh] = useReducer((count: number) => count + 1, 0)

  useEffect(() => {
    if (
      expiresAt === undefined ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const remaining = expiresAt - Date.now()
      if (remaining <= 0) refresh()
      else timer = setTimeout(schedule, Math.min(remaining, maxTimerMs))
    }
    schedule()
    return () => clearTimeout(timer)
  }, [expiresAt])

  return expiresAt === undefined || expiresAt > Date.now()
}
