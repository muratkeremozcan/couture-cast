import { NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import express, { type Request, type Response, type Express } from 'express'
import { AppModule } from '../src/app.module'

let serverPromise: Promise<Express> | null = null

async function bootstrap(): Promise<Express> {
  const server = express()
  const adapter = new ExpressAdapter(server)
  const app = await NestFactory.create(AppModule, adapter, {
    bufferLogs: true,
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
