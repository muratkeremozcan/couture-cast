import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { validateShareCardPng } from '@couture/api-client'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const { ShareCardRenderer } = require(
  path.join(root, 'apps/api/dist/src/modules/share-cards/share-card-renderer.js')
)
const renderer = new ShareCardRenderer()
const bytes = await renderer.render(
  { kind: 'outfit', scenario: 'morning', categories: ['top', 'bottom', 'shoes'] },
  'en-US',
  true
)
validateShareCardPng(bytes)
const output = process.argv[2]
if (output) await fs.writeFile(output, bytes)
console.log(
  JSON.stringify({
    code: 'built_renderer_assets_verified',
    width: 1080,
    height: 1350,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
)
