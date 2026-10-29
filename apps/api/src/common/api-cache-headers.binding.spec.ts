import { RequestMethod, type MiddlewareConsumer } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module.js'
import { ApiCacheHeadersMiddleware } from './api-cache-headers.middleware.js'

describe('AppModule cache headers binding', () => {
  it('covers every /api/v1 route and method with the private no-store policy', () => {
    const forRoutes = vi.fn()
    const apply = vi.fn(() => ({ forRoutes }))
    new AppModule().configure({ apply } as unknown as MiddlewareConsumer)
    expect(apply).toHaveBeenCalledExactlyOnceWith(ApiCacheHeadersMiddleware)
    expect(forRoutes).toHaveBeenCalledExactlyOnceWith({
      path: '/api/v1{/*path}',
      method: RequestMethod.ALL,
    })
  })
})
