// api/incentives/index.js
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
    const { month, year } = req.query
    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'].includes(user.role)

    let query = supabase
      .from('incentives')
      .select('*, employee:employee_id (id, first_name, last_name)')
      .order('created_at', { ascending: false })

    if (!isAdmin) query = query.eq('employee_id', user.id)
    if (month) query = query.eq('for_month', month)
    if (year) query = query.eq('for_year', year)

    const { data, error } = await query
    if (error) return errorResponse(res, 500, error.message)
    return successResponse(res, data)
  }

  if (req.method === 'POST') {
    if (!['SUPER_ADMIN', 'ADMIN'].includes(user.role)) return errorResponse(res, 403, 'Forbidden')

    const { employee_id, incentive_type, amount, description, for_month, for_year } = req.body
    const { data, error } = await supabase
      .from('incentives')
      .insert({ employee_id, incentive_type, amount, description, for_month, for_year, added_by: user.id })
      .select()
      .single()

    if (error) return errorResponse(res, 500, error.message)
    return successResponse(res, data, 201)
  }

  return errorResponse(res, 405, 'Method not allowed')
}
