export declare const NATIVE_JOURNEY_LOCATION_KEY: string
export declare const NATIVE_JOURNEY_TEMPERATURE_C: number
export declare const NATIVE_JOURNEY_FEELS_LIKE_C: number
export declare function pinNativeJourneyWeather(prisma: {
  forecastSegment: {
    updateMany(args: {
      where: { weather_snapshot: { location_key: string } }
      data: { temperature: number; feels_like: number }
    }): Promise<{ count: number }>
  }
}): Promise<number>
