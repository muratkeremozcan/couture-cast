/* eslint-disable */
import { BaseAPI, type Configuration } from './runtime'
import {
  AlertsApi,
  AuthApi,
  EventsApi,
  GuardianApi,
  HealthApi,
  LocationsApi,
  ModerationApi,
  UserApi,
  WeatherApi,
} from './apis'

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

export interface DefaultApi
  extends PublicApi<AlertsApi>,
    PublicApi<AuthApi>,
    PublicApi<EventsApi>,
    PublicApi<GuardianApi>,
    PublicApi<HealthApi>,
    PublicApi<LocationsApi>,
    PublicApi<ModerationApi>,
    PublicApi<UserApi>,
    PublicApi<WeatherApi> {}

export class DefaultApi extends BaseAPI {
  constructor(configuration?: Configuration) {
    super(configuration)
  }
}

applyApiMixins(DefaultApi, [
  AlertsApi,
  AuthApi,
  EventsApi,
  GuardianApi,
  HealthApi,
  LocationsApi,
  ModerationApi,
  UserApi,
  WeatherApi,
])
