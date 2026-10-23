import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { AuthStateModule } from '../auth/auth-state.module'
import { RequestAuthGuard } from '../auth/security.guards'
import { OpenWeatherGeocodingClient } from '../weather/providers/openweather-geocoding.client'
import { OpenWeatherProvider } from '../weather/providers/openweather.provider'
import { resolveWeatherProviderMode } from '../weather/providers/weather.config'
import { WeatherApiGeocodingClient } from '../weather/providers/weatherapi-geocoding.client'
import { WeatherApiProvider } from '../weather/providers/weatherapi.provider'
import { WeatherRefreshQueue } from '../weather/weather-refresh.queue'
import { WeatherRepository } from '../weather/weather.repository'
import {
  LOCATION_CAPTURE_CLOCK,
  LOCATION_FORECAST_PROVIDER,
  LOCATION_GEOCODER,
  LocationCaptureService,
  systemLocationCaptureClock,
} from './location-capture.service'
import { LocationPreferencesController } from './location-preferences.controller'
import { PrismaLocationPreferencesRepository } from './location-preferences.repository'
import { LocationPreferencesService } from './location-preferences.service'
import { TelemetryModule } from '../telemetry/telemetry.module'

@Module({
  imports: [PrismaModule, AuthStateModule, TelemetryModule],
  controllers: [LocationPreferencesController],
  providers: [
    PrismaLocationPreferencesRepository,
    LocationPreferencesService,
    LocationCaptureService,
    WeatherRepository,
    WeatherRefreshQueue,
    RequestAuthGuard,
    // Story 1.2b: city search and the save-time forecast both follow
    // WEATHER_PROVIDER_MODE, on the provider's existing key.
    {
      provide: LOCATION_GEOCODER,
      useFactory: () =>
        resolveWeatherProviderMode() === 'weatherapi'
          ? new WeatherApiGeocodingClient()
          : new OpenWeatherGeocodingClient(),
    },
    {
      provide: LOCATION_FORECAST_PROVIDER,
      useFactory: () =>
        resolveWeatherProviderMode() === 'weatherapi'
          ? new WeatherApiProvider()
          : new OpenWeatherProvider(),
    },
    { provide: LOCATION_CAPTURE_CLOCK, useValue: systemLocationCaptureClock },
  ],
  exports: [LocationPreferencesService, PrismaLocationPreferencesRepository],
})
export class LocationPreferencesModule {}
