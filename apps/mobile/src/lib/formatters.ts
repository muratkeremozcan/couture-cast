// Step 22 step 2 owner: implement locale-aware currency and temperature formatting in apps/mobile/src/lib/formatters.ts
export function getTemperatureUnit(locale: string): 'F' | 'C' {
  if (locale === 'en-US') {
    return 'F'
  }
  return 'C'
}

export function formatTemperature(celsius: number, locale: string): string {
  const unit = getTemperatureUnit(locale)
  if (unit === 'F') {
    const fahrenheit = (celsius * 9) / 5 + 32
    return `${Math.round(fahrenheit)}°F`
  }
  return `${Math.round(celsius)}°C`
}

export function formatCurrency(amount: number, locale: string): string {
  let currency = 'USD'
  let formatLocale = 'en-US'

  switch (locale) {
    case 'en-CA':
      currency = 'CAD'
      formatLocale = 'en-CA'
      break
    case 'fr-CA':
      currency = 'CAD'
      formatLocale = 'fr-CA'
      break
    case 'fr-FR':
      currency = 'EUR'
      formatLocale = 'fr-FR'
      break
    case 'de-DE':
      currency = 'EUR'
      formatLocale = 'de-DE'
      break
    case 'it-IT':
      currency = 'EUR'
      formatLocale = 'it-IT'
      break
    case 'pt-BR':
      currency = 'BRL'
      formatLocale = 'pt-BR'
      break
    case 'pt-PT':
      currency = 'EUR'
      formatLocale = 'pt-PT'
      break
    case 'es-419':
      currency = 'USD' // default LatAm currency fallback
      formatLocale = 'es-419'
      break
    case 'tr-TR':
      currency = 'TRY'
      formatLocale = 'tr-TR'
      break
    case 'en-US':
    default:
      currency = 'USD'
      formatLocale = 'en-US'
  }

  try {
    return new Intl.NumberFormat(formatLocale, {
      style: 'currency',
      currency: currency,
    }).format(amount)
  } catch {
    // fallback if Intl not supported
    return `${amount} ${currency}`
  }
}

export function formatMeasurement(valueInCm: number, locale: string): string {
  if (locale === 'en-US') {
    const inches = valueInCm / 2.54
    return `${Math.round(inches * 10) / 10} in`
  }
  return `${Math.round(valueInCm)} cm`
}
