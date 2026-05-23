// src/lib/notifications.ts
import { supabase } from './supabase'

export interface WhatsAppNotification {
  recipientPhone: string
  recipientName: string
  messageType: 'LEAVE_APPROVED' | 'LEAVE_REJECTED' | 'SHIFT_HANDOVER' | 'LORRY_DUTY' | 'PAYSLIP_READY' | 'ATTENDANCE_ALERT'
  templateParams: Record<string, string>
}

interface WhatsAppSettings {
  whatsapp_token: string
  whatsapp_phone_id: string
  wa_attendance_notify: string
  wa_payslip_notify: string
}

/**
 * Send WhatsApp notification via Meta Cloud API
 * @param pumpId - Pump ID for fetching credentials
 * @param notification - Notification details
 * @returns true if sent successfully, false otherwise
 */
export async function sendWhatsAppNotification(
  pumpId: string,
  notification: WhatsAppNotification
): Promise<boolean> {
  try {
    // Fetch WhatsApp credentials from system_settings (schema uses key/value cols).
    // Always filter by pump_id — credentials are per-tenant.
    const { data: settingsData, error: settingsError } = await supabase
      .from('system_settings')
      .select('key, value')
      .eq('pump_id', pumpId)
      .in('key', ['whatsapp_token', 'whatsapp_phone_id', 'wa_attendance_notify', 'wa_payslip_notify'])

    if (settingsError || !settingsData || settingsData.length === 0) {
      console.warn('[WhatsApp] Settings not found for pump:', pumpId)
      await logNotification(pumpId, notification, 'NOT_CONFIGURED', 'WhatsApp settings not configured')
      return false
    }

    // Convert array to object
    const settings: Record<string, string> = {}
    settingsData.forEach((s: { key: string; value: string }) => {
      settings[s.key] = s.value
    })

    // Check if WhatsApp is configured
    if (!settings.whatsapp_token || !settings.whatsapp_phone_id) {
      console.warn('[WhatsApp] Missing credentials for pump:', pumpId)
      await logNotification(pumpId, notification, 'NOT_CONFIGURED', 'WhatsApp credentials missing')
      return false
    }

    // Check notification type settings
    if (notification.messageType === 'ATTENDANCE_ALERT' && settings.wa_attendance_notify !== 'true') {
      console.log('[WhatsApp] Attendance notifications disabled')
      return false
    }
    if (notification.messageType === 'PAYSLIP_READY' && settings.wa_payslip_notify !== 'true') {
      console.log('[WhatsApp] Payslip notifications disabled')
      return false
    }

    // Format phone number (remove non-digits, add country code if missing)
    const phone = formatPhoneNumber(notification.recipientPhone)

    // Get template name based on message type
    const templateName = getTemplateName(notification.messageType)

    // Build WhatsApp API request
    const whatsappApiUrl = `https://graph.facebook.com/v19.0/${settings.whatsapp_phone_id}/messages`

    const requestBody = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' },
        components: buildTemplateComponents(notification)
      }
    }

    // Send to Meta WhatsApp Cloud API
    const response = await fetch(whatsappApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.whatsapp_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    })

    const responseData = await response.json()

    if (!response.ok) {
      const errorMsg = responseData.error?.message || 'WhatsApp API error'
      console.error('[WhatsApp] API error:', errorMsg)
      await logNotification(pumpId, notification, 'FAILED', errorMsg)
      return false
    }

    // Log successful notification
    const messageId = responseData.messages?.[0]?.id || null
    await logNotification(pumpId, notification, 'SENT', null, messageId)

    console.log('[WhatsApp] Message sent successfully:', messageId)
    return true

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[WhatsApp] Error sending notification:', errorMsg)
    await logNotification(pumpId, notification, 'FAILED', errorMsg)
    return false
  }
}

/**
 * Format phone number for WhatsApp API (country code + 10 digits)
 */
function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '')

  // If starts with 91 and has 12 digits, return as-is
  if (digits.startsWith('91') && digits.length === 12) {
    return digits
  }

  // If 10 digits, add country code
  if (digits.length === 10) {
    return '91' + digits
  }

  // If 11 digits starting with 0, remove 0 and add country code
  if (digits.length === 11 && digits.startsWith('0')) {
    return '91' + digits.slice(1)
  }

  // Return as-is if already formatted
  return digits
}

/**
 * Get WhatsApp template name based on notification type
 * Note: These templates must be pre-approved in Meta Business Manager
 */
function getTemplateName(messageType: WhatsAppNotification['messageType']): string {
  const templates: Record<WhatsAppNotification['messageType'], string> = {
    LEAVE_APPROVED: 'leave_approved',
    LEAVE_REJECTED: 'leave_rejected',
    SHIFT_HANDOVER: 'shift_handover',
    LORRY_DUTY: 'lorry_duty_assigned',
    PAYSLIP_READY: 'payslip_ready',
    ATTENDANCE_ALERT: 'attendance_alert',
  }
  return templates[messageType]
}

/**
 * Build WhatsApp template components with parameters
 */
function buildTemplateComponents(notification: WhatsAppNotification) {
  const parameters = Object.entries(notification.templateParams).map(([key, value]) => ({
    type: 'text',
    text: value
  }))

  return [
    {
      type: 'body',
      parameters
    }
  ]
}

/**
 * Log notification to database for audit trail
 */
async function logNotification(
  pumpId: string,
  notification: WhatsAppNotification,
  status: 'SENT' | 'FAILED' | 'NOT_CONFIGURED',
  errorMessage: string | null = null,
  whatsappMessageId: string | null = null
): Promise<void> {
  try {
    await supabase.from('notification_log').insert({
      pump_id: pumpId,
      recipient_phone: notification.recipientPhone,
      recipient_name: notification.recipientName,
      message_type: notification.messageType,
      message_body: JSON.stringify(notification.templateParams),
      whatsapp_msg_id: whatsappMessageId,
      status,
      error_message: errorMessage,
      created_at: new Date().toISOString()
    })
  } catch (error) {
    console.error('[WhatsApp] Failed to log notification:', error)
  }
}

// ============================================
// Helper functions for specific notifications
// ============================================

/**
 * Send leave approval notification
 */
export async function notifyLeaveApproval(
  pumpId: string,
  employeeName: string,
  employeePhone: string,
  leaveType: string,
  startDate: string,
  endDate: string,
  isApproved: boolean
): Promise<boolean> {
  return sendWhatsAppNotification(pumpId, {
    recipientPhone: employeePhone,
    recipientName: employeeName,
    messageType: isApproved ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
    templateParams: {
      employee_name: employeeName,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
    }
  })
}

/**
 * Send shift handover notification
 */
export async function notifyShiftHandover(
  pumpId: string,
  incomingEmployeeName: string,
  incomingEmployeePhone: string,
  outgoingEmployeeName: string,
  handoverTime: string,
  notes: string = ''
): Promise<boolean> {
  return sendWhatsAppNotification(pumpId, {
    recipientPhone: incomingEmployeePhone,
    recipientName: incomingEmployeeName,
    messageType: 'SHIFT_HANDOVER',
    templateParams: {
      incoming_employee: incomingEmployeeName,
      outgoing_employee: outgoingEmployeeName,
      handover_time: handoverTime,
      notes: notes || 'No additional notes'
    }
  })
}

/**
 * Send lorry duty assignment notification
 */
export async function notifyLorryDuty(
  pumpId: string,
  employeeName: string,
  employeePhone: string,
  dutyDate: string,
  notes: string = ''
): Promise<boolean> {
  return sendWhatsAppNotification(pumpId, {
    recipientPhone: employeePhone,
    recipientName: employeeName,
    messageType: 'LORRY_DUTY',
    templateParams: {
      employee_name: employeeName,
      duty_date: dutyDate,
      notes: notes || 'Please confirm your availability'
    }
  })
}

/**
 * Send payslip ready notification
 */
export async function notifyPayslipReady(
  pumpId: string,
  employeeName: string,
  employeePhone: string,
  month: string,
  year: string,
  netSalary: string
): Promise<boolean> {
  return sendWhatsAppNotification(pumpId, {
    recipientPhone: employeePhone,
    recipientName: employeeName,
    messageType: 'PAYSLIP_READY',
    templateParams: {
      employee_name: employeeName,
      month,
      year,
      net_salary: netSalary
    }
  })
}

/**
 * Send attendance alert notification
 */
export async function notifyAttendanceAlert(
  pumpId: string,
  adminPhone: string,
  employeeName: string,
  alertType: 'LATE' | 'ABSENT' | 'CHECK_IN' | 'CHECK_OUT',
  time: string
): Promise<boolean> {
  return sendWhatsAppNotification(pumpId, {
    recipientPhone: adminPhone,
    recipientName: 'Admin',
    messageType: 'ATTENDANCE_ALERT',
    templateParams: {
      employee_name: employeeName,
      alert_type: alertType,
      time
    }
  })
}
