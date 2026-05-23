// api/employees/index.js
import { supabase } from '../_lib/supabase.js'
import { createError, successResponse, verifyAuth } from '../_lib/utils.js'

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 200 })

  let user
  try { user = await verifyAuth(request) } catch { return createError('Unauthorized', 401) }

  // GET — list all employees
  if (request.method === 'GET') {
    const { data, error } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, phone, role, employee_code, is_active, shift_type, date_of_joining, base_salary, created_at')
      .order('first_name')

    if (error) return createError(error.message, 500)
    return successResponse(data)
  }

  // POST — create employee (Admin+ only)
  if (request.method === 'POST') {
    if (!['SUPER_ADMIN', 'ADMIN'].includes(user.role)) return createError('Forbidden', 403)

    const body = await request.json()
    const {
      first_name, last_name, email, phone, role, employee_code,
      shift_type, date_of_joining, date_of_birth, base_salary,
      aadhar_number, bank_account_number, bank_ifsc,
      emergency_contact_name, emergency_contact_phone,
      address, preferred_language,
    } = body

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: Math.random().toString(36).slice(-8),
      email_confirm: true,
    })
    if (authError) return createError(authError.message, 400)

    const { data, error } = await supabase
      .from('users')
      .insert({
        auth_id: authData.user.id,
        first_name, last_name, email, phone,
        username: email.split('@')[0] + '_' + Date.now(),
        role: role || 'EMPLOYEE',
        employee_code, shift_type: shift_type || '12HR',
        date_of_joining, date_of_birth, base_salary,
        aadhar_number, bank_account_number, bank_ifsc,
        emergency_contact_name, emergency_contact_phone,
        address, preferred_language: preferred_language || 'en',
        is_active: true,
      })
      .select()
      .single()

    if (error) return createError(error.message, 500)
    return successResponse(data, 201)
  }

  return createError('Method not allowed', 405)
}
