// api/leaves/index.js
import { createClient } from '../_lib/supabase.js'
import { authenticate, errorResponse, successResponse } from '../_lib/utils.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = await authenticate(req)
  if (!user) return errorResponse(res, 401, 'Unauthorized')

  const supabase = createClient()

  if (req.method === 'GET') {
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(user.role)
    let query = supabase
      .from('leaves')
      .select(`
        *,
        employee:employee_id (id, first_name, last_name),
        backup_employee:backup_employee_id (id, first_name, last_name),
        approved_by_user:approved_by (id, first_name, last_name)
      `)
      .order('created_at', { ascending: false })

    if (!isAdmin) query = query.eq('employee_id', user.id)

    const { data, error } = await query
    if (error) return errorResponse(res, 500, error.message)
    return successResponse(res, data)
  }

  if (req.method === 'POST') {
    const { leave_type, from_date, to_date, reason, backup_employee_id, backup_notes } = req.body
    const { data, error } = await supabase
      .from('leaves')
      .insert({
        employee_id: user.id,
        leave_type, from_date, to_date, reason,
        backup_employee_id: backup_employee_id || null,
        backup_notes: backup_notes || null,
        status: 'PENDING',
      })
      .select()
      .single()

    if (error) return errorResponse(res, 500, error.message)
    return successResponse(res, data, 201)
  }

  return errorResponse(res, 405, 'Method not allowed')
}
