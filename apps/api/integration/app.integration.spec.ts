import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'

vi.mock('@prisma/client', () => {
  class PrismaClientMock {
    $disconnect = vi.fn()
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
