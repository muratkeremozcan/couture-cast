import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { PostHogService } from './posthog/posthog.service'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port)

  try {
    void app.get(PostHogService).capture({
      distinctId: 'api',
      event: 'api_started',
      properties: {
        port,
        nodeEnv: process.env.NODE_ENV ?? 'unknown',
      },
    })
  } catch {
    // Startup should continue even if telemetry wiring fails.
  }
}

void bootstrap()
