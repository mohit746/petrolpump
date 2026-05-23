// api/incentives/[id]/pay.js
import { createClient } from '../_lib/supabase.js'
import { authenticate, errorResponse, successResponse } from '../_lib/utils.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = await authenticate(req)
  if (!user) return errorResponse(res, 401, 'Unauthorized')
  if (!['SUPER_ADMIN', 'ADMIN'].includes(user.role)) return errorResponse(res, 403, 'Forbidden')

  const { id } = req.query
  const supabase = createClient()

  const { data, error } = await supabase
    .from('incentives')
    .update({ is_paid: true, paid_on: new Date().toISOString().split('T')[0] })
    .eq('id', id)
    .select()
    .single()

  if (error) return errorResponse(res, 500, error.message)
  return successResponse(res, data)
}
