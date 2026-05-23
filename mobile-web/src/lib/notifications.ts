// src/lib/notifications.ts
// WhatsApp Cloud API (Meta) — 1000 free conversations/month
// Falls back to console log / email if not configured
// Scalable: swap WHATSAPP for email by changing sendNotification()

import { supabase } from './supabase'

interface NotificationPayload {
  recipientPhone: string   // with country code e.g. 919876543210
  recipientName: string
  messageType: string
  templateName: string
  parameters: string[]     // template variable replacements
}

// ─── Send WhatsApp template message ───────────────────────────────────────────
export async function sendWhatsApp(payload: NotificationPayload): Promise<boolean> {
  // Get credentials from system_settings (stored securely in DB, only super admin can update)
  const { data: settings } = await supabase
    .from('system_settings')
    .select('whatsapp_phone_number_id, whatsapp_access_token')
    .single()

  if (!settings?.whatsapp_phone_number_id || !settings?.whatsapp_access_token) {
    console.warn('WhatsApp not configured. Log only:', payload.messageType, payload.recipientName)
    await logNotification({ ...payload, status: 'NOT_CONFIGURED' })
    return false
  }

  const body = {
    messaging_product: 'whatsapp',
    to: payload.recipientPhone,
    type: 'template',
    template: {
      name: payload.templateName,
      language: { code: 'en_IN' },
      components: [
        {
          type: 'body',
          parameters: payload.parameters.map(p => ({ type: 'text', text: p })),
        },
      ],
    },
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${settings.whatsapp_phone_number_id}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.whatsapp_access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    )

    const data = await res.json()
    const msgId = data?.messages?.[0]?.id

    await logNotification({
      ...payload,
      status: msgId ? 'SENT' : 'FAILED',
      whatsappMsgId: msgId,
    })

    return !!msgId
  } catch (err) {
    console.error('WhatsApp send failed:', err)
    await logNotification({ ...payload, status: 'FAILED' })
    return false
  }
}

async function logNotification(payload: NotificationPayload & { status: string; whatsappMsgId?: string }) {
  await supabase.from('notification_log').insert({
    recipient_phone: payload.recipientPhone,
    recipient_name: payload.recipientName,
    message_type: payload.messageType,
    message_body: payload.parameters.join(' | '),
    whatsapp_msg_id: payload.whatsappMsgId,
    status: payload.status,
  })
}

// ─── Typed notification helpers ────────────────────────────────────────────────

/** Notify replacement employee about shift handover request */
export async function notifyShiftHandover(opts: {
  toName: string
  toPhone: string
  fromName: string
  date: string
  time: string
}) {
  return sendWhatsApp({
    recipientPhone: opts.toPhone,
    recipientName: opts.toName,
    messageType: 'HANDOVER_REQUEST',
    templateName: 'shift_handover_request',
    // Template: "Hi {{1}}, {{2}} has requested you to cover their shift on {{3}} at {{4}}. Please confirm in the PumpManager app."
    parameters: [opts.toName, opts.fromName, opts.date, opts.time],
  })
}

/** Notify about lorry duty assignment */
export async function notifyLorryDuty(opts: {
  toName: string
  toPhone: string
  date: string
  terminal: string
  allowance: string
}) {
  return sendWhatsApp({
    recipientPhone: opts.toPhone,
    recipientName: opts.toName,
    messageType: 'LORRY_DUTY',
    templateName: 'lorry_duty_assigned',
    // Template: "Hi {{1}}, you are assigned for lorry/fuel duty on {{2}} to {{3}}. Allowance: ₹{{4}}. Please confirm in PumpManager app."
    parameters: [opts.toName, opts.date, opts.terminal, opts.allowance],
  })
}

/** Notify admin when lorry duty is refused */
export async function notifyLorryRefused(opts: {
  toName: string
  toPhone: string
  refusedBy: string
  date: string
  backupName?: string
}) {
  return sendWhatsApp({
    recipientPhone: opts.toPhone,
    recipientName: opts.toName,
    messageType: 'LORRY_REFUSED',
    templateName: 'lorry_duty_refused',
    // Template: "⚠ {{1}} refused lorry duty on {{2}}. {{3}}"
    parameters: [
      opts.refusedBy,
      opts.date,
      opts.backupName ? `Suggested backup: ${opts.backupName}` : 'No backup available — action needed!',
    ],
  })
}

/** Notify employee about leave decision */
export async function notifyLeaveDecision(opts: {
  toName: string
  toPhone: string
  decision: 'APPROVED' | 'REJECTED'
  fromDate: string
  toDate: string
  reason?: string
}) {
  return sendWhatsApp({
    recipientPhone: opts.toPhone,
    recipientName: opts.toName,
    messageType: 'LEAVE_DECISION',
    templateName: 'leave_decision',
    // Template: "Hi {{1}}, your leave from {{2}} to {{3}} has been {{4}}. {{5}}"
    parameters: [
      opts.toName, opts.fromDate, opts.toDate,
      opts.decision,
      opts.reason ? `Reason: ${opts.reason}` : '',
    ],
  })
}

/** Send monthly payroll summary to super admin */
export async function notifyMonthlyReport(opts: {
  toPhone: string
  toName: string
  month: string
  year: string
  totalEmployees: string
  totalPayroll: string
}) {
  return sendWhatsApp({
    recipientPhone: opts.toPhone,
    recipientName: opts.toName,
    messageType: 'MONTHLY_REPORT',
    templateName: 'monthly_report_summary',
    // Template: "📊 Monthly Report {{1}} {{2}}: {{3}} employees, Total payroll: ₹{{4}}. View details in PumpManager app."
    parameters: [opts.month, opts.year, opts.totalEmployees, opts.totalPayroll],
  })
}
