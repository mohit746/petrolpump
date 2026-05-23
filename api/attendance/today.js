// api/attendance/today.js
import { createClient } from '../_lib/supabase.js'
import { authenticate, errorResponse, successResponse } from '../_lib/utils.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = await authenticate(req)
  if (!user) return errorResponse(res, 401, 'Unauthorized')

  const supabase = createClient()
  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('employee_id', user.id)
    .eq('attendance_date', today)
    .maybeSingle()

  if (error) return errorResponse(res, 500, error.message)
  return successResponse(res, data)
}
