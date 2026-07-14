import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sendImageMessage,
  sendTemplateMessage,
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
  contact_id?: string
  organization_id?: string
  idempotency_key?: string
  message_type?: 'text' | 'image' | 'template'
  content_text?: string
  image_url?: string
  whatsapp_media_id?: string
  template_name?: string
  template_language?: string
  template_params?: string[]
  allow_agent_mode_send?: boolean
  clear_stale_handoff_if_agent_mode?: boolean
}

const BLOCKED_AUTOMATION_MODES = new Set(['human', 'manual', 'paused', 'off'])

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
    const bodyContactId = body.contact_id?.trim() ?? ''
    const organizationId = body.organization_id?.trim() ?? ''
    const idempotencyKey = body.idempotency_key?.trim() ?? ''
    const messageType = body.message_type
    const contentText = body.content_text?.trim() || ''
    const allowAgentModeSend = body.allow_agent_mode_send === true
    const clearStaleHandoffIfAgentMode =
      body.clear_stale_handoff_if_agent_mode === true

    if (!conversationId || !isUuid(conversationId)) {
      return NextResponse.json(
        { error: 'conversation_id must be a valid UUID' },
        { status: 400 },
      )
    }

    if (messageType !== 'text' && messageType !== 'image' && messageType !== 'template') {
      return NextResponse.json(
        { error: 'message_type must be "text", "image", or "template"' },
        { status: 400 },
      )
    }

    if (messageType === 'text' && !contentText) {
      return NextResponse.json(
        { error: 'content_text is required for text messages' },
        { status: 400 },
      )
    }

    if (messageType === 'template' && !body.template_name?.trim()) {
      return NextResponse.json(
        { error: 'template_name is required for template messages' },
        { status: 400 },
      )
    }

    const db = supabaseAdmin()

    if (idempotencyKey) {
      let duplicateQuery = db
        .from('messages')
        .select('id, message_id')
        .eq('idempotency_key', idempotencyKey)
      if (organizationId && isUuid(organizationId)) {
        duplicateQuery = duplicateQuery.eq('organization_id', organizationId)
      }
      const { data: existingMessage } = await duplicateQuery.maybeSingle()
      if (existingMessage) {
        return NextResponse.json({
          success: true,
          duplicate: true,
          message_id: existingMessage.id,
          whatsapp_message_id: existingMessage.message_id,
        })
      }
    }

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

    if (organizationId && conversation.organization_id !== organizationId) {
      return NextResponse.json(
        { error: 'Conversation does not belong to organization' },
        { status: 403 },
      )
    }

    if (contact.organization_id && contact.organization_id !== conversation.organization_id) {
      return NextResponse.json(
        { error: 'Contact does not belong to conversation organization' },
        { status: 403 },
      )
    }

    if (bodyContactId && contact.id !== bodyContactId) {
      return NextResponse.json(
        { error: 'contact_id does not belong to conversation' },
        { status: 403 },
      )
    }

    if (contact.opted_out) {
      return NextResponse.json(
        { error: 'Contact has opted out of WhatsApp replies' },
        { status: 403 },
      )
    }

    const { data: activeHandoff } = await db
      .from('human_handoffs')
      .select('id')
      .eq('organization_id', conversation.organization_id)
      .eq('conversation_id', conversationId)
      .in('status', ['open', 'accepted'])
      .limit(1)
      .maybeSingle()

    const sendState = evaluateN8nSendConversationState({
      automationMode: conversation.automation_mode,
      automationPaused: Boolean(conversation.automation_paused),
      handoffActive: Boolean(activeHandoff),
      assignedAgentId: conversation.assigned_agent_id ?? null,
      allowAgentModeSend,
    })

    if (!sendState.allowed) {
      return NextResponse.json(
        { error: 'Conversation is human-owned or automation is paused' },
        { status: 409 },
      )
    }

    if (
      sendState.clearStaleHandoffAllowed &&
      clearStaleHandoffIfAgentMode
    ) {
      await clearStaleAgentModeHandoff({
        db,
        organizationId: conversation.organization_id,
        conversationId,
      })
    }

    if (messageType !== 'template') {
      const { data: latestInbound } = await db
        .from('messages')
        .select('created_at')
        .eq('conversation_id', conversationId)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const inboundAt = latestInbound?.created_at
      const insideServiceWindow =
        inboundAt &&
        Date.now() - new Date(inboundAt).getTime() <= 24 * 60 * 60 * 1000
      if (!insideServiceWindow) {
        return NextResponse.json(
          {
            error:
              'Free-form WhatsApp replies require an inbound customer message inside the 24-hour service window. Use an approved template.',
          },
          { status: 403 },
        )
      }
    }

    const sanitizedPhone = sanitizePhoneForMeta(contact.phone)
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json(
        { error: `Invalid contact phone format: ${contact.phone}` },
        { status: 400 },
      )
    }

    const { data: orgConfig } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('organization_id', conversation.organization_id)
      .maybeSingle()

    let activeConfig = orgConfig
    if (!activeConfig) {
      const fallback = await db
        .from('whatsapp_config')
        .select('*')
        .eq('user_id', conversation.user_id)
        .maybeSingle()
      if (fallback.error || !fallback.data) {
        return NextResponse.json(
          { error: 'WhatsApp config not found for conversation organization' },
          { status: 400 },
        )
      }
      activeConfig = fallback.data
    }

    const accessToken = decrypt(activeConfig.access_token)

    let imageMediaId: string | null = null
    if (messageType === 'image') {
      try {
        imageMediaId = await resolveImageMediaId({
          phoneNumberId: activeConfig.phone_number_id,
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
          phoneNumberId: activeConfig.phone_number_id,
          accessToken,
          to,
          mediaId: imageMediaId,
          caption: contentText || undefined,
        })
        return sent.messageId
      }

      if (messageType === 'template') {
        const sent = await sendTemplateMessage({
          phoneNumberId: activeConfig.phone_number_id,
          accessToken,
          to,
          templateName: body.template_name!.trim(),
          language: body.template_language ?? 'en_US',
          params: body.template_params ?? [],
        })
        return sent.messageId
      }

      const sent = await sendTextMessage({
        phoneNumberId: activeConfig.phone_number_id,
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
      organization_id: conversation.organization_id,
      sender_type: 'bot',
      content_type: messageType,
      content_text: messageType === 'image' ? (contentText || null) : contentText,
      media_url:
        messageType === 'image' && imageMediaId
          ? `/api/whatsapp/media/${imageMediaId}`
          : null,
      template_name: messageType === 'template' ? body.template_name!.trim() : null,
      message_id: waMessageId,
      idempotency_key: idempotencyKey || null,
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
            : contentText ||
              (messageType === 'template'
                ? `[template:${body.template_name!.trim()}]`
                : '[image]'),
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

export function evaluateN8nSendConversationState(args: {
  automationMode?: string | null
  automationPaused: boolean
  handoffActive: boolean
  assignedAgentId?: string | null
  allowAgentModeSend: boolean
}) {
  const automationMode = args.automationMode ?? 'agent'
  const isAgentMode = automationMode === 'agent'
  const isHumanMode = BLOCKED_AUTOMATION_MODES.has(automationMode)

  if (args.automationPaused || isHumanMode) {
    return { allowed: false, clearStaleHandoffAllowed: false }
  }

  if (args.handoffActive && !(isAgentMode && args.allowAgentModeSend)) {
    return { allowed: false, clearStaleHandoffAllowed: false }
  }

  if (args.assignedAgentId && !(isAgentMode && args.allowAgentModeSend)) {
    return { allowed: false, clearStaleHandoffAllowed: false }
  }

  return {
    allowed: true,
    clearStaleHandoffAllowed:
      args.handoffActive && isAgentMode && args.allowAgentModeSend,
  }
}

async function clearStaleAgentModeHandoff(args: {
  db: ReturnType<typeof supabaseAdmin>
  organizationId: string
  conversationId: string
}) {
  await args.db
    .from('human_handoffs')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', args.organizationId)
    .eq('conversation_id', args.conversationId)
    .in('status', ['open', 'accepted'])

  await args.db
    .from('conversations')
    .update({
      automation_mode: 'agent',
      automation_paused: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)
    .eq('organization_id', args.organizationId)
    .eq('automation_mode', 'agent')
}
