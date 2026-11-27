// Learning path Step 71: Today's outfit as a picture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-71-todays-outfit-as-a-picture
import { readFileSync } from 'node:fs'
import http from 'node:http'
import { setTimeout } from 'node:timers/promises'

const route = '/__today_visual/'
const variants = new Set(['full', 'missing', 'empty'])

/** Only the Android visual shard uses this loopback proxy. Other API traffic is unchanged. */
export async function startTodayVisualFixtures({
  apiOrigin,
  mobileHost,
  accessToken,
  garmentId,
}) {
  const photo = readFileSync(
    new URL(
      '../../apps/api/test/fixtures/garment-tagging/neutral-top.png',
      import.meta.url
    )
  )
  const upstream = new URL(apiOrigin)
  const bearer = `Bearer ${accessToken}`
  let variant = 'full'
  let missingPhoto = Promise.withResolvers()
  let mobileOrigin
  async function serveFixtureRoute(request, response, action) {
    if (request.method === 'POST' && variants.has(action)) {
      variant = action
      missingPhoto = Promise.withResolvers()
      response.writeHead(204).end()
    } else if (request.method !== 'GET') {
      response.writeHead(405).end()
    } else if (action === 'photo.png') {
      response.writeHead(200, { 'content-type': 'image/png' }).end(photo)
    } else if (action === 'missing.png') {
      const markMissing = missingPhoto.resolve
      response.writeHead(404).end(() => markMissing(true))
    } else if (action === 'missing-requested') {
      const requested = await Promise.race([
        missingPhoto.promise,
        setTimeout(10_000, false, { ref: false }),
      ])
      response.writeHead(requested ? 204 : 408).end()
    } else response.writeHead(404).end()
  }

  async function serveRitual(request, response, selected) {
    try {
      const actual = await fetch(`${apiOrigin}${request.url}`, {
        headers: { authorization: bearer },
        signal: AbortSignal.timeout(15_000),
      })
      const body = await actual.json()
      if (actual.ok) {
        // Chicago's seeded rain entry represents 10°C in the centered capture. Its position
        // in the local morning shifts with the seed time. Keep real timestamps for the
        // hourly ribbon and give every possible scenario the same representative conditions.
        const { weather } = body.data
        const rain = weather.hourly.find(
          (entry) => entry.temperature === 10 && entry.condition === 'rain'
        )
        if (!rain)
          throw new Error('The Today visual fixture needs the seeded 10°C rain hour')
        weather.hourly = weather.hourly.map(({ forecastAt }) => ({ ...rain, forecastAt }))
        const empty = selected === 'empty'
        const filename = selected === 'missing' ? 'missing.png' : 'photo.png'
        for (const outfit of body.data.outfits) {
          outfit.garmentIds = [
            empty ? 'default-top' : garmentId,
            'default-bottom',
            'default-shoes',
          ]
          outfit.displayGarments = empty
            ? []
            : [
                {
                  id: garmentId,
                  category: 'top',
                  imageAccess: {
                    url: `${mobileOrigin}${route}${filename}`,
                    expiresAt: new Date(Date.now() + 900_000).toISOString(),
                  },
                },
              ]
        }
      }
      response
        .writeHead(actual.status, { 'content-type': 'application/json' })
        .end(JSON.stringify(body))
    } catch {
      response.writeHead(502).end()
    }
  }

  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, apiOrigin).pathname
    if (pathname.startsWith(route))
      return serveFixtureRoute(request, response, pathname.slice(route.length))

    const memberRead =
      request.method === 'GET' && request.headers.authorization === bearer
    if (
      memberRead &&
      pathname === '/api/v1/wardrobe/garments' &&
      request.headers['x-couture-today-wardrobe'] === '1' &&
      variant === 'empty'
    ) {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}')
      return
    }
    if (memberRead && pathname === '/api/v1/ritual')
      return serveRitual(request, response, variant)

    const forwarded = http.request(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, host: upstream.host },
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(response)
      }
    )
    forwarded.on('error', () => {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    })
    response.on('close', () => forwarded.destroy())
    request.pipe(forwarded)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  mobileOrigin = `http://${mobileHost}:${port}`
  return {
    port,
    mobileOrigin,
    controlUrl: `http://127.0.0.1:${port}${route}`,
    close: async () => {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
