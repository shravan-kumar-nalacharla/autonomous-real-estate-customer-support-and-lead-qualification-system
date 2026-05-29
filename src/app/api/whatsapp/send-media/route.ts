import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendImageMessage, uploadMediaFromBuffer } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  isRecipientNotAllowedError,
  isValidE164,
  phoneVariants,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

function getStringField(formData: FormData, key: string): string {
  const raw = formData.get(key)
  return typeof raw === 'string' ? raw.trim() : ''
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      )
    }

    const limit = checkRateLimit(`send-media:${user.id}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const formData = await request.formData()
    const conversationId = getStringField(formData, 'conversation_id')
    const messageType = getStringField(formData, 'message_type')
    const caption = getStringField(formData, 'caption')
    const replyToMessageId = getStringField(formData, 'reply_to_message_id')
    const maybeFile = formData.get('file')

    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 },
      )
    }

    if (messageType !== 'image') {
      return NextResponse.json(
        { error: 'Only image media is supported right now' },
        { status: 400 },
      )
    }

    if (!(maybeFile instanceof File)) {
      return NextResponse.json(
        { error: 'file is required' },
        { status: 400 },
      )
    }

    if (maybeFile.size <= 0) {
      return NextResponse.json(
        { error: 'Uploaded image is empty' },
        { status: 400 },
      )
    }

    if (!maybeFile.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'file must be an image' },
        { status: 400 },
      )
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*, contact:contacts(*)')
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .single()

    if (convError || !conversation) {
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
        { error: 'Invalid phone number format' },
        { status: 400 },
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 },
      )
    }

    const accessToken = decrypt(config.access_token)

    let contextMessageId: string | undefined
    if (replyToMessageId) {
      const { data: parent, error: parentError } = await supabase
        .from('messages')
        .select('message_id, conversation_id')
        .eq('id', replyToMessageId)
        .eq('conversation_id', conversationId)
        .maybeSingle()

      if (parentError || !parent) {
        return NextResponse.json(
          { error: 'reply_to_message_id not found in this conversation' },
          { status: 400 },
        )
      }
      if (parent.message_id) {
        contextMessageId = parent.message_id
      }
    }

    const arrayBuffer = await maybeFile.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const filename = maybeFile.name || `image-${Date.now()}.jpg`

    let uploadedMediaId = ''
    try {
      const uploaded = await uploadMediaFromBuffer({
        phoneNumberId: config.phone_number_id,
        accessToken,
        buffer,
        filename,
        mimeType: maybeFile.type || 'application/octet-stream',
      })
      uploadedMediaId = uploaded.mediaId
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown upload error'
      return NextResponse.json(
        { error: `Failed to upload media to WhatsApp: ${message}` },
        { status: 502 },
      )
    }

    let waMessageId = ''
    let workingPhone = sanitizedPhone
    let lastError: unknown = null

    for (const variant of phoneVariants(sanitizedPhone)) {
      try {
        const sent = await sendImageMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: variant,
          mediaId: uploadedMediaId,
          caption: caption || undefined,
          contextMessageId,
        })
        waMessageId = sent.messageId
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
          `[whatsapp/send-media] variant "${variant}" rejected by Meta, trying next...`,
        )
      }
    }

    if (lastError) {
      const message = lastError instanceof Error ? lastError.message : 'Unknown Meta API error'
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 },
      )
    }

    if (workingPhone !== sanitizedPhone) {
      await supabase
        .from('contacts')
        .update({ phone: workingPhone })
        .eq('id', contact.id)
    }

    const { data: savedMessage, error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'image',
        content_text: caption || null,
        media_url: `/api/whatsapp/media/${uploadedMediaId}`,
        message_id: waMessageId,
        status: 'sent',
        reply_to_message_id: replyToMessageId || null,
      })
      .select('id')
      .single()

    if (msgError || !savedMessage) {
      return NextResponse.json(
        {
          error:
            `Message sent to Meta but failed to save to DB: ${msgError?.message ?? 'unknown error'}`,
        },
        { status: 500 },
      )
    }

    await supabase
      .from('conversations')
      .update({
        last_message_text: caption || '[image]',
        last_message_at: new Date().toISOString(),
        automation_mode: 'human',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    // Best-effort pause for active flow runs; a human has stepped in.
    try {
      const { error: pauseErr } = await supabaseAdmin()
        .from('flow_runs')
        .update({
          status: 'paused_by_agent',
          ended_at: new Date().toISOString(),
          end_reason: 'agent_replied',
        })
        .eq('user_id', user.id)
        .eq('contact_id', contact.id)
        .eq('status', 'active')
      if (pauseErr) {
        console.error('[flows] pause-on-agent-send-media failed:', pauseErr.message)
      }
    } catch (error) {
      console.error(
        '[flows] pause-on-agent-send-media threw:',
        error instanceof Error ? error.message : error,
      )
    }

    return NextResponse.json({
      success: true,
      message_id: savedMessage.id,
      whatsapp_message_id: waMessageId,
      media_id: uploadedMediaId,
    })
  } catch (error) {
    console.error('[whatsapp/send-media] unhandled error:', error)
    return NextResponse.json(
      { error: 'Failed to send media message' },
      { status: 500 },
    )
  }
}

