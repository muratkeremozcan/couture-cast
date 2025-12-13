// Skip Husky install in CI/Vercel/production to keep deploy builds green.
if (
  process.env.CI === 'true' ||
  process.env.VERCEL === '1' ||
  process.env.NODE_ENV === 'production'
) {
  process.exit(0)
}

const husky = (await import('husky')).default
husky()
