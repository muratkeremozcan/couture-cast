import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type TestingModule, Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'

vi.mock('@prisma/client', () => {
  class PrismaClientMock {
    $disconnect = vi.fn()
    // createPrismaClient extends the client; the mock is its own extension.
    $extends() {
      return this
    }
  }
  return { PrismaClient: PrismaClientMock }
})

import { AppController } from '../src/app.controller'
import { AppService } from '../src/app.service'

describe('AppController (integration)', () => {
  let app: INestApplication | undefined
  let controller: AppController

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    controller = app.get(AppController)
  })

  afterEach(async () => {
    if (app) {
      await app.close()
      app = undefined
    }
  })

  it('wires controller through Nest container', () => {
    expect(controller.getHello()).toBe('Hello World!')
  })
})
