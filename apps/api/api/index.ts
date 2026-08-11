import { NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import express, { type Request, type Response, type Express } from 'express'
import { AppModule } from '../src/app.module'

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
