// api/attendance/mark.js
import { createClient } from '../_lib/supabase.js'
import { authenticate, errorResponse, successResponse } from '../_lib/utils.js'

const PUMP_ALLOWED_RADIUS_METERS = 200 // default fallback

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') return errorResponse(res, 405, 'Method not allowed')

  const user = await authenticate(req)
  if (!user) return errorResponse(res, 401, 'Unauthorized')

  const { type, latitude, longitude, accuracy } = req.body
  if (!['CHECK_IN', 'CHECK_OUT'].includes(type)) return errorResponse(res, 400, 'Invalid type')

  const supabase = createClient()
  const today = new Date().toISOString().split('T')[0]
  const now = new Date().toISOString()

  // Get pump location for geo-fence check
  const { data: pumpLoc } = await supabase
    .from('pump_locations')
    .select('*')
    .eq('is_primary', true)
    .maybeSingle()

  let verified = false
  if (latitude && longitude && pumpLoc) {
    const dist = haversine(latitude, longitude, pumpLoc.latitude, pumpLoc.longitude)
    verified = dist <= (pumpLoc.allowed_radius_meters || PUMP_ALLOWED_RADIUS_METERS)
  }

  // Check existing record
  const { data: existing } = await supabase
    .from('attendance')
    .select('*')
    .eq('employee_id', user.id)
    .eq('attendance_date', today)
    .maybeSingle()

  let result, error

  if (type === 'CHECK_IN') {
    if (existing?.check_in_time) return errorResponse(res, 400, 'Already checked in today')

    const payload = {
      employee_id: user.id,
      attendance_date: today,
      status: 'PRESENT',
      check_in_time: now,
      check_in_latitude: latitude || null,
      check_in_longitude: longitude || null,
      check_in_accuracy: accuracy || null,
      check_in_verified: verified,
    }

    if (existing) {
      ;({ data: result, error } = await supabase
        .from('attendance').update(payload).eq('id', existing.id).select().single())
    } else {
      ;({ data: result, error } = await supabase
        .from('attendance').insert(payload).select().single())
    }
  } else {
    // CHECK_OUT
    if (!existing?.check_in_time) return errorResponse(res, 400, 'Not checked in yet')
    if (existing?.check_out_time) return errorResponse(res, 400, 'Already checked out')

    ;({ data: result, error } = await supabase
      .from('attendance')
      .update({
        check_out_time: now,
        check_out_latitude: latitude || null,
        check_out_longitude: longitude || null,
        check_out_accuracy: accuracy || null,
        check_out_verified: verified,
      })
      .eq('id', existing.id)
      .select()
      .single())
  }

  if (error) return errorResponse(res, 500, error.message)
  return successResponse(res, result)
}
