import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { AppModule } from '../src/app.module'
import { AppController } from '../src/app.controller'

describe('AppController (integration)', () => {
  let app: INestApplication
  let controller: AppController

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    controller = app.get(AppController)
  })

  afterEach(async () => {
    await app.close()
  })

  it('wires controller through Nest container', () => {
    expect(controller.getHello()).toBe('Hello World!')
  })
})
