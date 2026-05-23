// api/employees/[id].js
import { supabase } from '../_lib/supabase.js'
import { createError, successResponse, verifyAuth } from '../_lib/utils.js'

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 200 })

  let user
  try { user = await verifyAuth(request) } catch { return createError('Unauthorized', 401) }

  if (!['SUPER_ADMIN', 'ADMIN'].includes(user.role)) return createError('Forbidden', 403)

  const url = new URL(request.url)
  const id = url.pathname.split('/').pop()

  if (request.method === 'PUT' || request.method === 'PATCH') {
    const body = await request.json()
    const allowed = [
      'first_name', 'last_name', 'phone', 'role', 'employee_code',
      'shift_type', 'date_of_joining', 'date_of_birth', 'base_salary',
      'aadhar_number', 'bank_account_number', 'bank_ifsc',
      'emergency_contact_name', 'emergency_contact_phone',
      'address', 'preferred_language', 'is_active',
    ]
    const updates = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)))

    const { data, error } = await supabase
      .from('users').update(updates).eq('id', id).select().single()

    if (error) return createError(error.message, 500)
    return successResponse(data)
  }

  return createError('Method not allowed', 405)
}
