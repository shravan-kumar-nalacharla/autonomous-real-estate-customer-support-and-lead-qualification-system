import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sendImageMessage,
  sendTextMessage,
  uploadMediaFromBuffer,
} from '@/lib/whatsapp/meta-api'
import {
  isRecipientNotAllowedError,
  isValidE164,
  phoneVariants,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils'

interface SendBody {
  conversation_id?: string
  message_type?: 'text' | 'image'
  content_text?: string
  image_url?: string
  whatsapp_media_id?: string
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

function isAuthorized(request: Request): boolean {
  const expected = process.env.N8N_INTERNAL_SECRET
  if (!expected) return false

  const got = request.headers.get('x-internal-secret') ?? ''
  const expectedBuf = Buffer.from(expected)
  const gotBuf = Buffer.from(got)

  if (expectedBuf.length !== gotBuf.length) return false
  return timingSafeEqual(expectedBuf, gotBuf)
}

function normalizeFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const last = pathname.split('/').filter(Boolean).pop()
    if (last && last.length > 0) return last
  } catch {
    // ignored, fallback below
  }
  return `n8n-image-${Date.now()}.jpg`
}

async function resolveImageMediaId(args: {
  phoneNumberId: string
  accessToken: string
  imageUrl?: string
  whatsappMediaId?: string
}): Promise<string> {
  const fromBody = args.whatsappMediaId?.trim()
  if (fromBody) return fromBody

  const imageUrl = args.imageUrl?.trim()
  if (!imageUrl) {
    throw new Error('For image messages, provide whatsapp_media_id or image_url')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(imageUrl)
  } catch {
    throw new Error('image_url must be a valid URL')
  }

  const imageRes = await fetch(parsedUrl.toString(), {
    signal: AbortSignal.timeout(15_000),
  })
  if (!imageRes.ok) {
    throw new Error(`Failed to download image_url: HTTP ${imageRes.status}`)
  }

  const rawContentType = imageRes.headers.get('content-type') ?? ''
  const mimeType = rawContentType.split(';')[0]?.trim() || 'application/octet-stream'
  if (!mimeType.startsWith('image/')) {
    throw new Error(`image_url content-type is not image/* (got "${mimeType}")`)
  }

  const buffer = Buffer.from(await imageRes.arrayBuffer())
  if (buffer.length === 0) {
    throw new Error('image_url returned an empty file')
  }

  const { mediaId } = await uploadMediaFromBuffer({
    phoneNumberId: args.phoneNumberId,
    accessToken: args.accessToken,
    buffer,
    filename: normalizeFilenameFromUrl(parsedUrl.toString()),
    mimeType,
  })

  return mediaId
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => null)) as SendBody | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const conversationId = body.conversation_id?.trim() ?? ''
    const messageType = body.message_type
    const contentText = body.content_text?.trim() || ''

    if (!conversationId || !isUuid(conversationId)) {
      return NextResponse.json(
        { error: 'conversation_id must be a valid UUID' },
        { status: 400 },
      )
    }

    if (messageType !== 'text' && messageType !== 'image') {
      return NextResponse.json(
        { error: 'message_type must be "text" or "image"' },
        { status: 400 },
      )
    }

    if (messageType === 'text' && !contentText) {
      return NextResponse.json(
        { error: 'content_text is required for text messages' },
        { status: 400 },
      )
    }

    const db = supabaseAdmin()

    const { data: conversation, error: conversationError } = await db
      .from('conversations')
      .select('*, contact:contacts(*)')
      .eq('id', conversationId)
      .single()

    if (conversationError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      )
    }

    const contact = Array.isArray(conversation.contact)
      ? conversation.contact[0]
      : conversation.contact
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 },
      )
    }

    const sanitizedPhone = sanitizePhoneForMeta(contact.phone)
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json(
        { error: `Invalid contact phone format: ${contact.phone}` },
        { status: 400 },
      )
    }

    const { data: config, error: configError } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', conversation.user_id)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        { error: 'WhatsApp config not found for conversation owner' },
        { status: 400 },
      )
    }

    const accessToken = decrypt(config.access_token)

    let imageMediaId: string | null = null
    if (messageType === 'image') {
      try {
        imageMediaId = await resolveImageMediaId({
          phoneNumberId: config.phone_number_id,
          accessToken,
          imageUrl: body.image_url,
          whatsappMediaId: body.whatsapp_media_id,
        })
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof Error ? error.message : 'Failed to prepare image media',
          },
          { status: 400 },
        )
      }
    }

    const attemptSend = async (to: string): Promise<string> => {
      if (messageType === 'image' && imageMediaId) {
        const sent = await sendImageMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to,
          mediaId: imageMediaId,
          caption: contentText || undefined,
        })
        return sent.messageId
      }

      const sent = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to,
        text: contentText,
      })
      return sent.messageId
    }

    let waMessageId = ''
    let workingPhone = sanitizedPhone
    let lastError: unknown = null

    for (const variant of phoneVariants(sanitizedPhone)) {
      try {
        waMessageId = await attemptSend(variant)
        workingPhone = variant
        lastError = null
        break
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!isRecipientNotAllowedError(message)) {
          lastError = error
          break
        }
        lastError = error
        console.warn(
          `[n8n/internal-send] variant "${variant}" rejected by Meta, trying next...`,
        )
      }
    }

    if (lastError) {
      const message = lastError instanceof Error ? lastError.message : String(lastError)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 },
      )
    }

    if (workingPhone !== sanitizedPhone) {
      await db
        .from('contacts')
        .update({ phone: workingPhone, updated_at: new Date().toISOString() })
        .eq('id', contact.id)
    }

    const messageInsert = {
      conversation_id: conversationId,
      sender_type: 'bot',
      content_type: messageType === 'image' ? 'image' : 'text',
      content_text: messageType === 'image' ? (contentText || null) : contentText,
      media_url:
        messageType === 'image' && imageMediaId
          ? `/api/whatsapp/media/${imageMediaId}`
          : null,
      message_id: waMessageId,
      status: 'sent',
    }

    const { data: savedMessage, error: messageError } = await db
      .from('messages')
      .insert(messageInsert)
      .select('id')
      .single()

    if (messageError || !savedMessage) {
      return NextResponse.json(
        {
          error: `Message sent to Meta but failed to save in DB: ${messageError?.message ?? 'unknown error'}`,
        },
        { status: 500 },
      )
    }

    await db
      .from('conversations')
      .update({
        last_message_text:
          messageType === 'text'
            ? contentText
            : contentText || '[image]',
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    return NextResponse.json({
      success: true,
      message_id: savedMessage.id,
      whatsapp_message_id: waMessageId,
    })
  } catch (error) {
    console.error('[n8n/internal-send] unhandled error:', error)
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 },
    )
  }
}
