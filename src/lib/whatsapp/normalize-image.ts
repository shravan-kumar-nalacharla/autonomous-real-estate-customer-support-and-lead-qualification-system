import sharp from 'sharp'

interface WhatsAppImage {
  buffer: Buffer
  filename: string
  mimeType: string
}

export async function normalizeWhatsAppImage(
  image: WhatsAppImage
): Promise<WhatsAppImage> {
  const format = (await sharp(image.buffer).metadata()).format
  const filename = image.filename.replace(/\.[^.]+$/, '') || 'upload'

  if (format === 'jpeg') {
    return { ...image, filename: `${filename}.jpg`, mimeType: 'image/jpeg' }
  }
  if (format === 'png') {
    return { ...image, filename: `${filename}.png`, mimeType: 'image/png' }
  }

  return {
    buffer: await sharp(image.buffer)
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 90 })
      .toBuffer(),
    filename: `${filename}.jpg`,
    mimeType: 'image/jpeg',
  }
}
