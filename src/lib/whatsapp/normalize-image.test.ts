import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { normalizeWhatsAppImage } from './normalize-image'

describe('normalizeWhatsAppImage', () => {
  it('converts AVIF bytes mislabeled as JPEG into a real JPEG', async () => {
    const avif = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: '#336699',
      },
    })
      .avif()
      .toBuffer()

    const normalized = await normalizeWhatsAppImage({
      buffer: avif,
      filename: 'property.jpg',
      mimeType: 'image/jpeg',
    })

    expect(normalized.mimeType).toBe('image/jpeg')
    expect(normalized.filename).toBe('property.jpg')
    expect((await sharp(normalized.buffer).metadata()).format).toBe('jpeg')
  })
})
