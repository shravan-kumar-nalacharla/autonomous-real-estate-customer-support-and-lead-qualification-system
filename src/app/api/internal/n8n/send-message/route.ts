import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sendInteractiveButtons,
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
  message_type?: 'text' | 'image' | 'template' | 'interactive'
  content_text?: string
  image_url?: string
  whatsapp_media_id?: string
  template_name?: string
  template_language?: string
  template_params?: string[]
  raw_whatsapp_payload?: unknown
  source?: string
  allow_agent_mode_send?: boolean
  clear_stale_handoff_if_agent_mode?: boolean
}

interface InteractiveButtonPayload {
  type: 'button'
  body: { text: string }
  action: {
    buttons: Array<{
      type: 'reply'
      reply: { id: string; title: string }
    }>
  }
  header?: { type?: string; text?: string }
  footer?: { text?: string }
}

const BLOCKED_AUTOMATION_MODES = new Set([
  'human',
  'manual',
  'paused',
  'off',
  'disabled',
])

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
    let contentText = body.content_text?.trim() || ''
    const source = body.source?.trim() || 'n8n'
    const allowAgentModeSend = body.allow_agent_mode_send === true
    const clearStaleHandoffIfAgentMode =
      body.clear_stale_handoff_if_agent_mode === true

    if (!conversationId || !isUuid(conversationId)) {
      return NextResponse.json(
        { error: 'conversation_id must be a valid UUID' },
        { status: 400 },
      )
    }

    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'idempotency_key is required for internal sends' },
        { status: 400 },
      )
    }

    if (
      messageType !== 'text' &&
      messageType !== 'image' &&
      messageType !== 'template' &&
      messageType !== 'interactive'
    ) {
      return NextResponse.json(
        { error: 'message_type must be "text", "image", "template", or "interactive"' },
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

    let interactivePayload: InteractiveButtonPayload | null = null
    if (messageType === 'interactive') {
      const parsed = normalizeInteractiveButtonPayload(body.raw_whatsapp_payload)
      if ('error' in parsed) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      interactivePayload = parsed.payload
      contentText = contentText || interactivePayload.body.text
    }

    const db = supabaseAdmin()

    if (idempotencyKey) {
      let duplicateQuery = db
        .from('messages')
        .select('id, message_id, status')
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
          status: existingMessage.status,
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

    const reservedMessage = await reserveOutboundMessage({
      db,
      organizationId: conversation.organization_id,
      conversationId,
      messageType,
      contentText,
      imageMediaId,
      templateName: messageType === 'template' ? body.template_name!.trim() : null,
      idempotencyKey,
      rawPayload: messageType === 'interactive' ? interactivePayload : body.raw_whatsapp_payload,
      source,
    })
    if ('error' in reservedMessage) {
      return NextResponse.json({ error: reservedMessage.error }, { status: 500 })
    }
    if (reservedMessage.duplicate) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message_id: reservedMessage.message.id,
        whatsapp_message_id: reservedMessage.message.message_id,
        status: reservedMessage.message.status,
      })
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

      if (messageType === 'interactive' && interactivePayload) {
        const sent = await sendInteractiveButtons({
          phoneNumberId: activeConfig.phone_number_id,
          accessToken,
          to,
          bodyText: interactivePayload.body.text,
          headerText:
            interactivePayload.header?.type === 'text'
              ? interactivePayload.header.text
              : undefined,
          footerText: interactivePayload.footer?.text,
          buttons: interactivePayload.action.buttons.map((button) => ({
            id: button.reply.id,
            title: button.reply.title,
          })),
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
      await db
        .from('messages')
        .update({
          status: 'failed',
        })
        .eq('id', reservedMessage.message.id)
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

    const { data: savedMessage, error: messageError } = await db
      .from('messages')
      .update({
        media_url:
          messageType === 'image' && imageMediaId
            ? `/api/whatsapp/media/${imageMediaId}`
            : null,
        message_id: waMessageId,
        status: 'sent',
      })
      .eq('id', reservedMessage.message.id)
      .select('id')
      .maybeSingle()

    if (messageError || !savedMessage) {
      console.error(
        '[n8n/internal-send] Meta send succeeded but CRM message update failed:',
        messageError?.message ?? 'unknown error',
      )
      return NextResponse.json({
        success: true,
        warning: 'Message sent to Meta but CRM status update failed; idempotency row is reserved.',
        message_id: reservedMessage.message.id,
        whatsapp_message_id: waMessageId,
      })
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

export function normalizeInteractiveButtonPayload(
  rawPayload: unknown,
): { payload: InteractiveButtonPayload } | { error: string } {
  const payload = rawPayload as Partial<InteractiveButtonPayload> | null
  if (!payload || typeof payload !== 'object') {
    return { error: 'raw_whatsapp_payload is required for interactive messages' }
  }
  if (payload.type !== 'button') {
    return { error: 'Only interactive button messages are supported' }
  }
  const bodyText = payload.body?.text?.trim()
  if (!bodyText) {
    return { error: 'Interactive button body text is required' }
  }
  const buttons = payload.action?.buttons
  if (!Array.isArray(buttons) || buttons.length < 1 || buttons.length > 3) {
    return { error: 'Interactive button messages require 1-3 buttons' }
  }

  const normalizedButtons: InteractiveButtonPayload['action']['buttons'] = []
  const seenIds = new Set<string>()
  for (const button of buttons) {
    if (button?.type !== 'reply') {
      return { error: 'Interactive buttons must use type "reply"' }
    }
    const id = button.reply?.id?.trim()
    const title = button.reply?.title?.trim()
    if (!id) return { error: 'Interactive button reply id is required' }
    if (!title) return { error: 'Interactive button title is required' }
    if (id.length > 256) {
      return { error: 'Interactive button reply id exceeds 256 chars' }
    }
    if (title.length > 20) {
      return { error: 'Interactive button title exceeds 20 chars' }
    }
    if (seenIds.has(id)) {
      return { error: `Interactive button reply id "${id}" is duplicated` }
    }
    seenIds.add(id)
    normalizedButtons.push({
      type: 'reply',
      reply: { id, title },
    })
  }

  return {
    payload: {
      type: 'button',
      body: { text: bodyText },
      action: { buttons: normalizedButtons },
      ...(payload.header ? { header: payload.header } : {}),
      ...(payload.footer ? { footer: payload.footer } : {}),
    },
  }
}

export async function reserveOutboundMessage(args: {
  db: ReturnType<typeof supabaseAdmin>
  organizationId: string
  conversationId: string
  messageType: 'text' | 'image' | 'template' | 'interactive'
  contentText: string
  imageMediaId: string | null
  templateName: string | null
  idempotencyKey: string
  rawPayload: unknown
  source: string
}): Promise<
  | {
      duplicate: boolean
      message: { id: string; message_id?: string | null; status?: string | null }
    }
  | { error: string }
> {
  const insertPayload = {
    conversation_id: args.conversationId,
    organization_id: args.organizationId,
    sender_type: 'bot',
    content_type: args.messageType,
    content_text:
      args.messageType === 'image' ? args.contentText || null : args.contentText,
    media_url:
      args.messageType === 'image' && args.imageMediaId
        ? `/api/whatsapp/media/${args.imageMediaId}`
        : null,
    template_name: args.templateName,
    message_id: null,
    idempotency_key: args.idempotencyKey || null,
    raw_payload: args.rawPayload ?? null,
    source: args.source,
    status: 'sending',
  }

  const { data, error } = await args.db
    .from('messages')
    .insert(insertPayload)
    .select('id, message_id, status')
    .single()

  if (!error && data) {
    return { duplicate: false, message: data }
  }

  if (args.idempotencyKey) {
    const { data: existing } = await args.db
      .from('messages')
      .select('id, message_id, status')
      .eq('organization_id', args.organizationId)
      .eq('idempotency_key', args.idempotencyKey)
      .maybeSingle()
    if (existing) {
      return { duplicate: true, message: existing }
    }
  }

  return {
    error: `Failed to reserve outbound message before Meta send: ${error?.message ?? 'unknown error'}`,
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
