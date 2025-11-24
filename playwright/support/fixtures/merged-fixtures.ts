import { expect, mergeTests, test as base } from '@playwright/test'
import { test as apiClientFixture } from './api-client'
import { test as authFixture } from './auth'
import { test as networkFixture } from './network'

export const test = mergeTests(base, apiClientFixture, authFixture, networkFixture)
export { expect }
