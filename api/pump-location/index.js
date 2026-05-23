// api/pump-location/index.js
import { createClient } from '../_lib/supabase.js'
import { authenticate, errorResponse, successResponse } from '../_lib/utils.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = await authenticate(req)
  if (!user) return errorResponse(res, 401, 'Unauthorized')

  const supabase = createClient()

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('pump_locations')
      .select('*')
      .eq('is_primary', true)
      .maybeSingle()

    if (error) return errorResponse(res, 500, error.message)
    return successResponse(res, data)
  }

  if (req.method === 'PUT') {
    if (!['SUPER_ADMIN', 'ADMIN'].includes(user.role)) return errorResponse(res, 403, 'Forbidden')
    const { name, latitude, longitude, allowed_radius_meters } = req.body

    // Upsert primary location
    const { data, error } = await supabase
      .from('pump_locations')
      .upsert({ name, latitude, longitude, allowed_radius_meters, is_primary: true })
      .select()
      .single()

    if (error) return errorResponse(res, 500, error.message)
    return successResponse(res, data)
  }

  return errorResponse(res, 405, 'Method not allowed')
}
