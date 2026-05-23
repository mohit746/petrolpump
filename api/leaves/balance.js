// api/leaves/balance.js
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
  const year = new Date().getFullYear()

  // Get or auto-create leave balance for current year
  let { data, error } = await supabase
    .from('leave_balances')
    .select('*')
    .eq('employee_id', user.id)
    .eq('year', year)
    .maybeSingle()

  if (!data && !error) {
    // Create default balance
    const { data: created, error: createErr } = await supabase
      .from('leave_balances')
      .insert({ employee_id: user.id, year })
      .select()
      .single()
    if (createErr) return errorResponse(res, 500, createErr.message)
    data = created
  }

  if (error) return errorResponse(res, 500, error.message)
  return successResponse(res, data)
}
