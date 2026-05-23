// api/attendance/index.js
import { supabase } from '../_lib/supabase.js'
import { createError, successResponse, verifyAuth } from '../_lib/utils.js'

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 200 })

  let user
  try { user = await verifyAuth(request) } catch { return createError('Unauthorized', 401) }

  if (request.method !== 'GET') return createError('Method not allowed', 405)

  const url = new URL(request.url)
  const month = url.searchParams.get('month')
  const year = url.searchParams.get('year')
  const employeeId = url.searchParams.get('employeeId')

  const targetEmployee = employeeId && ['SUPER_ADMIN', 'ADMIN'].includes(user.role)
    ? employeeId
    : user.id

  let query = supabase
    .from('attendance')
    .select('*')
    .eq('employee_id', targetEmployee)
    .order('attendance_date', { ascending: false })

  if (month && year) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`
    const end = new Date(Number(year), Number(month), 0).toISOString().split('T')[0]
    query = query.gte('attendance_date', start).lte('attendance_date', end)
  }

  const { data, error } = await query
  if (error) return createError(error.message, 500)
  return successResponse(data)
}
