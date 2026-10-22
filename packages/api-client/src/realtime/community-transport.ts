// Story 6.5 owner: fresh-token websocket-only transport and bounded reconnect.
import { io, type Socket } from 'socket.io-client'
import {
  communityDoorbellSchema,
  communityAvailabilitySchema,
} from '../contracts/http/community-sync'
export type CommunityTransportState =
  | 'connected'
  | 'unavailable'
  | 'denied'
  | 'recovering'
export function connectCommunityTransport(options: {
  baseUrl: string
  token: () => Promise<string | undefined>
  changed: () => void
  state: (state: CommunityTransportState) => void
}) {
  let socket: Socket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let stable: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let generation = 0
  let backoff = 500
  const retry = () => {
    if (stopped || timer) return
    timer = setTimeout(
      () => {
        timer = undefined
        void connect()
      },
      backoff + Math.random() * backoff * 0.2
    )
    backoff = Math.min(15_000, backoff * 2)
  }
  const connect = async () => {
    const request = ++generation
    socket?.removeAllListeners()
    socket?.disconnect()
    socket = undefined
    if (stable) clearTimeout(stable)
    try {
      const token = await options.token()
      if (stopped || request !== generation) return
      if (!token) {
        options.state('denied')
        return
      }
      const next = io(`${options.baseUrl.replace(/\/$/, '')}/community`, {
        path: '/api/realtime',
        addTrailingSlash: false,
        transports: ['websocket'],
        auth: { token },
        reconnection: false,
        forceNew: true,
        autoConnect: false,
        timeout: 2000,
      })
      socket = next
      next.on('connect', () => {
        if (stopped || next !== socket) return
        options.state('connected')
        stable = setTimeout(() => {
          backoff = 500
        }, 30_000)
      })
      next.on('community:changed', (data: unknown) => {
        if (stopped || next !== socket) return
        if (communityDoorbellSchema.safeParse(data).success) options.changed()
      })
      next.on('community:availability', (data: unknown) => {
        if (stopped || next !== socket) return
        const parsed = communityAvailabilitySchema.safeParse(data)
        if (!parsed.success) return
        if (stable) clearTimeout(stable)
        options.state(parsed.data.status)
        next.removeAllListeners()
        next.disconnect()
        if (parsed.data.status === 'denied') stopped = true
        else retry()
      })
      const disconnected = () => {
        if (stopped || next !== socket) return
        if (stable) clearTimeout(stable)
        options.state('recovering')
        retry()
      }
      next.on('disconnect', disconnected)
      next.on('connect_error', (error: unknown) => {
        if (stopped || next !== socket) return
        if (stable) clearTimeout(stable)
        const data: unknown =
          error && typeof error === 'object' && 'data' in error ? error.data : undefined
        const control = communityAvailabilitySchema.safeParse(data)
        if (!control.success) {
          disconnected()
          return
        }
        options.state(control.data.status)
        next.removeAllListeners()
        next.disconnect()
        if (control.data.status === 'denied') stopped = true
        else retry()
      })
      next.connect()
    } catch {
      if (!stopped) {
        options.state('unavailable')
        retry()
      }
    }
  }
  void connect()
  return () => {
    stopped = true
    generation++
    if (timer) clearTimeout(timer)
    if (stable) clearTimeout(stable)
    socket?.removeAllListeners()
    socket?.disconnect()
  }
}
