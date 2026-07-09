import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ZodError } from 'zod'
import {
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

@Controller('/api/v1/locations')
@UseGuards(RequestAuthGuard)
export class LocationPreferencesController {
  constructor(
    @Inject(LocationPreferencesService)
    private readonly locationPreferencesService: LocationPreferencesService
  ) {}

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
