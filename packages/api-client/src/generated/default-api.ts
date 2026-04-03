/* eslint-disable */
import { BaseAPI, type Configuration } from './runtime'
import { EventsApi, HealthApi } from './apis'

type PublicApi<T> = Pick<T, keyof T>

function applyApiMixins(
  derivedCtor: typeof DefaultApi,
  baseCtors: Array<typeof BaseAPI>
) {
  for (const baseCtor of baseCtors) {
    for (const propertyName of Object.getOwnPropertyNames(baseCtor.prototype)) {
      if (propertyName === 'constructor') {
        continue
      }

      const descriptor = Object.getOwnPropertyDescriptor(baseCtor.prototype, propertyName)
      if (descriptor) {
        Object.defineProperty(derivedCtor.prototype, propertyName, descriptor)
      }
    }
  }
}

export interface DefaultApi extends PublicApi<EventsApi>, PublicApi<HealthApi> {}

export class DefaultApi extends BaseAPI {
  constructor(configuration?: Configuration) {
    super(configuration)
  }
}

applyApiMixins(DefaultApi, [EventsApi, HealthApi])
