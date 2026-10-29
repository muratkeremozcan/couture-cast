import { join } from 'node:path'

// Fontconfig sees only the versioned bundled families; system catalogs never participate.
process.env.PANGOCAIRO_BACKEND = 'fc'
process.env.FONTCONFIG_FILE = join(__dirname, 'assets', 'fonts.conf')

/** Inspect the bundled font cmap before handing catalog text to Pango. */
export function assertFontGlyphs(font: Buffer, text: string): void {
  const count = font.readUInt16BE(4)
  let cmap = 0
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16
    if (font.toString('ascii', record, record + 4) === 'cmap')
      cmap = font.readUInt32BE(record + 8)
  }
  if (!cmap) throw new Error('font_unavailable')
  const tables: number[] = []
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++)
    tables.push(cmap + font.readUInt32BE(cmap + 8 + i * 8))
  const supports = (code: number) =>
    tables.some((table) => {
      const format = font.readUInt16BE(table)
      if (format === 12) {
        for (let i = 0; i < font.readUInt32BE(table + 12); i++) {
          const at = table + 16 + i * 12
          const first = font.readUInt32BE(at)
          const last = font.readUInt32BE(at + 4)
          if (code >= first && code <= last)
            return font.readUInt32BE(at + 8) + code - first !== 0
        }
      }
      if (format === 4 && code <= 65535) {
        const segments = font.readUInt16BE(table + 6) / 2
        for (let i = 0; i < segments; i++) {
          const end = font.readUInt16BE(table + 14 + i * 2)
          const start = font.readUInt16BE(table + 16 + segments * 2 + i * 2)
          if (code < start || code > end) continue
          const delta = font.readInt16BE(table + 16 + segments * 4 + i * 2)
          const rangeAt = table + 16 + segments * 6 + i * 2
          const range = font.readUInt16BE(rangeAt)
          if (!range) return ((code + delta) & 65535) !== 0
          const glyph = font.readUInt16BE(rangeAt + range + (code - start) * 2)
          return glyph !== 0 && ((glyph + delta) & 65535) !== 0
        }
      }
      return false
    })
  for (const character of text) {
    const code = character.codePointAt(0)
    if (code === undefined || !supports(code)) throw new Error('unsupported_glyph')
  }
}
