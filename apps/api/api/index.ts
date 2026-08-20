import { NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import express, { type Request, type Response, type Express } from 'express'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/bootstrap/configure-app'

let serverPromise: Promise<Express> | null = null

async function bootstrap(): Promise<Express> {
  const server = express()
  const adapter = new ExpressAdapter(server)
  // THIS is the bootstrap preview and production run: `vercel.json` maps
  // `functions: { "api/index.ts": ... }` and rewrites `/(.*)` to `/api/index`, so
  // `src/main.ts` is never reached in a deployed environment.
  //
  // `rawBody: true` therefore has to be set here as well as there. Without it the
  // affiliate conversion webhook has no bytes to verify its HMAC against and 401s
  // every signed delivery in preview and production while passing locally.
  const app = await NestFactory.create(AppModule, adapter, {
    bufferLogs: true,
    rawBody: true,
  })

  // Before `init()`, not after: Express middleware registered post-initialization
  // never joins the stack, and it fails open — no error, just no request context
  // and no logs.
  //
  // This call is why `api_error_occurred` exists in preview and production at
  // all. Until it was added, this entry created a Nest app and initialized it,
  // and nothing else. Nest's built-in filter emits the same response envelope
  // `ApiExceptionFilter` does, so nothing looked broken while every deployed
  // error went unrecorded.
  configureApp(app)

  await app.init()
  return server
}

export default async function handler(req: Request, res: Response): Promise<void> {
  if (!serverPromise) {
    serverPromise = bootstrap()
  }
  const server = await serverPromise
  server(req, res)
}
