// api/leaves/[id].js
import { createClient } from '../_lib/supabase.js'
import { authenticate, errorResponse, successResponse } from '../_lib/utils.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = await authenticate(req)
  if (!user) return errorResponse(res, 401, 'Unauthorized')

  const { id } = req.query
  const supabase = createClient()

  if (req.method === 'PATCH') {
    const { action, reason } = req.body
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(user.role)

    if (action === 'APPROVE' || action === 'REJECT') {
      if (!isAdmin) return errorResponse(res, 403, 'Only admins can approve/reject leaves')

      const { data, error } = await supabase
        .from('leaves')
        .update({
          status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          rejection_reason: action === 'REJECT' ? reason : null,
        })
        .eq('id', id)
        .select()
        .single()

      if (error) return errorResponse(res, 500, error.message)
      return successResponse(res, data)
    }

    if (action === 'CANCEL') {
      const { data, error } = await supabase
        .from('leaves')
        .update({ status: 'CANCELLED' })
        .eq('id', id)
        .eq('employee_id', user.id) // can only cancel own leaves
        .eq('status', 'PENDING')
        .select()
        .single()

      if (error) return errorResponse(res, 500, error.message)
      return successResponse(res, data)
    }

    return errorResponse(res, 400, 'Invalid action')
  }

  return errorResponse(res, 405, 'Method not allowed')
}
