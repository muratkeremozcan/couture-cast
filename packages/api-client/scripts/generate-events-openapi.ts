#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  alertWeatherEventSchema,
  lookbookNewEventSchema,
  ritualUpdateEventSchema,
} from '../src/types/socket-events'

extendZodWithOpenApi(z)

const registry = new OpenAPIRegistry()

registry.register('LookbookNewEvent', lookbookNewEventSchema)
registry.register('RitualUpdateEvent', ritualUpdateEventSchema)
registry.register('AlertWeatherEvent', alertWeatherEventSchema)

const generator = new OpenApiGeneratorV31(registry.definitions)
const doc = generator.generateDocument({
  openapi: '3.1.0',
  info: {
    title: 'Socket Event Schemas',
    version: '0.1.0',
    description: 'Shared payload schemas for ADR-007 namespaces',
  },
  servers: [
    {
      url: 'https://api.couture-cast.example',
      description: 'Placeholder server for schema validation',
    },
  ],
})

const outputDir = resolve(process.cwd(), 'docs')
mkdirSync(outputDir, { recursive: true })
const outputPath = resolve(outputDir, 'socket-events.openapi.json')
writeFileSync(outputPath, JSON.stringify(doc, null, 2))
console.log(`✅ Wrote ${outputPath}`)
