import type { Request } from 'express'

declare module 'express-serve-static-core' {
  interface Request {
    id?: string | number | object
  }
}

export type RequestWithId = Request
