import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import { ZodError } from 'zod'
import {
  createSavedLocationFromSearchInputSchema,
  createSavedLocationFromSearchResponseSchema,
  defaultSupportedLocale,
  locationHeadersSchema,
  locationSearchQueryParamsSchema,
  locationSearchResponseSchema,
  type CreateSavedLocationFromSearchResponse,
  type LocationPlatform,
  type LocationSearchResponse,
  createSavedLocationInputSchema,
  createSavedLocationResponseSchema,
  deleteSavedLocationResponseSchema,
  listSavedLocationsResponseSchema,
  setPrimarySavedLocationResponseSchema,
  updateSavedLocationInputSchema,
  updateSavedLocationResponseSchema,
  type CreateSavedLocationResponse,
  type DeleteSavedLocationResponse,
  type ListSavedLocationsResponse,
  type SetPrimarySavedLocationResponse,
  type UpdateSavedLocationResponse,
} from '../../contracts/http'
import { AuthContext } from '../auth/security.decorators'
import { RequestAuthGuard } from '../auth/security.guards'
import type { RequestAuthContext } from '../auth/security.types'
import {
  LocationSearchRateLimitException,
  locationRequestError,
} from './location-capture.errors'
import { LocationCaptureService } from './location-capture.service'
import { LocationPreferencesService } from './location-preferences.service'

function isZodError(error: unknown): error is ZodError {
  return (
    error instanceof ZodError ||
    (error instanceof Error &&
      error.name === 'ZodError' &&
      'issues' in error &&
      Array.isArray((error as ZodError).issues))
  )
}

function toBadRequest(error: unknown): never {
  if (isZodError(error)) {
    throw new BadRequestException(error.issues.map((issue) => issue.message).join('; '))
  }

  throw error
}

function parseLocationId(locationId: string): string {
  const trimmed = locationId.trim()
  if (!trimmed) {
    throw new BadRequestException('Invalid saved location ID')
  }

  return trimmed
}

function parsePlatform(header: string | undefined): LocationPlatform {
  const parsed = locationHeadersSchema.safeParse({ 'x-couture-platform': header })
  if (!parsed.success) {
    throw locationRequestError(
      'invalid_request',
      'Missing or invalid x-couture-platform header'
    )
  }
  return parsed.data['x-couture-platform']
}

@Controller('/api/v1/locations')
@UseGuards(RequestAuthGuard)
export class LocationPreferencesController {
  constructor(
    @Inject(LocationPreferencesService)
    private readonly locationPreferencesService: LocationPreferencesService,
    @Inject(LocationCaptureService)
    private readonly locationCaptureService: LocationCaptureService
  ) {}

  /**
   * Story 1.2b. The query string is validated before anything else runs, so a
   * short or long query never reaches the rate limit or the provider. A 429
   * carries `Retry-After`; the body stays the shared rate-limit shape.
   */
  @Get('search')
  async searchLocations(
    @AuthContext() auth: RequestAuthContext,
    @Query() rawQuery: Record<string, unknown>,
    @Headers('x-couture-platform') platformHeader: string | undefined,
    @Res({ passthrough: true }) response: Response
  ): Promise<LocationSearchResponse> {
    const query = locationSearchQueryParamsSchema.safeParse(rawQuery)
    if (!query.success) {
      throw locationRequestError(
        'invalid_request',
        'Search text must be 2 to 80 characters'
      )
    }
    const platform = parsePlatform(platformHeader)
    try {
      const data = await this.locationCaptureService.search(
        auth.userId,
        query.data.q,
        query.data.locale ?? defaultSupportedLocale,
        platform
      )
      return locationSearchResponseSchema.parse({ data })
    } catch (error) {
      if (error instanceof LocationSearchRateLimitException) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds))
      }
      throw error
    }
  }

  @Post('from-search')
  async createLocationFromSearch(
    @AuthContext() auth: RequestAuthContext,
    @Body() body: unknown,
    @Headers('x-couture-platform') platformHeader: string | undefined
  ): Promise<CreateSavedLocationFromSearchResponse> {
    const input = createSavedLocationFromSearchInputSchema.safeParse(body)
    if (!input.success) {
      throw locationRequestError('invalid_request', 'Invalid saved location request')
    }
    const platform = parsePlatform(platformHeader)
    const data = await this.locationCaptureService.saveFromSearch(
      auth.userId,
      input.data.candidateToken,
      input.data.label,
      platform
    )
    return createSavedLocationFromSearchResponseSchema.parse({ data })
  }

  @Get()
  async listLocations(
    @AuthContext() auth: RequestAuthContext
  ): Promise<ListSavedLocationsResponse> {
    const data = await this.locationPreferencesService.listLocations(auth.userId)

    return listSavedLocationsResponseSchema.parse({ data })
  }

  @Post()
  async createLocation(
    @AuthContext() auth: RequestAuthContext,
    @Body() body: unknown
  ): Promise<CreateSavedLocationResponse> {
    try {
      const input = createSavedLocationInputSchema.parse(body)
      const data = await this.locationPreferencesService.createLocation(
        auth.userId,
        input
      )

      return createSavedLocationResponseSchema.parse({ data })
    } catch (error) {
      return toBadRequest(error)
    }
  }

  @Patch(':locationId')
  async updateLocation(
    @AuthContext() auth: RequestAuthContext,
    @Param('locationId') locationId: string,
    @Body() body: unknown
  ): Promise<UpdateSavedLocationResponse> {
    try {
      const input = updateSavedLocationInputSchema.parse(body)
      const data = await this.locationPreferencesService.updateLocation(
        auth.userId,
        parseLocationId(locationId),
        input
      )

      return updateSavedLocationResponseSchema.parse({ data })
    } catch (error) {
      return toBadRequest(error)
    }
  }

  @Post(':locationId/primary')
  @HttpCode(200)
  async setPrimary(
    @AuthContext() auth: RequestAuthContext,
    @Param('locationId') locationId: string
  ): Promise<SetPrimarySavedLocationResponse> {
    const data = await this.locationPreferencesService.setPrimary(
      auth.userId,
      parseLocationId(locationId)
    )

    return setPrimarySavedLocationResponseSchema.parse({ data })
  }

  @Delete(':locationId')
  @HttpCode(200)
  async deleteLocation(
    @AuthContext() auth: RequestAuthContext,
    @Param('locationId') locationId: string
  ): Promise<DeleteSavedLocationResponse> {
    const data = await this.locationPreferencesService.deleteLocation(
      auth.userId,
      parseLocationId(locationId)
    )

    return deleteSavedLocationResponseSchema.parse({ data })
  }
}
