import { BadRequestException } from '@nestjs/common'
import { ZodError } from 'zod'

export function isZodError(error: unknown): error is ZodError {
  return (
    error instanceof ZodError ||
    (error instanceof Error &&
      error.name === 'ZodError' &&
      'issues' in error &&
      Array.isArray((error as ZodError).issues))
  )
}

export function toBadRequest(error: unknown): never {
  if (isZodError(error)) {
    throw new BadRequestException(error.issues.map((issue) => issue.message).join('; '))
  }
  throw error
}
