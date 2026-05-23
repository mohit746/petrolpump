// api/fuel-loads/[id]/status.js
import { createClient } from '../_lib/supabase.js'
import { authenticate, errorResponse, successResponse } from '../_lib/utils.js'

const VALID_STATUSES = ['DEPARTED', 'ARRIVED', 'COMPLETED', 'CANCELLED']

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = await authenticate(req)
  if (!user) return errorResponse(res, 401, 'Unauthorized')

  const { id } = req.query
  const { status, latitude, longitude, received_quantity_liters, loaded_quantity_liters } = req.body

  if (!VALID_STATUSES.includes(status)) return errorResponse(res, 400, 'Invalid status')

  const supabase = createClient()
  const now = new Date().toISOString()

  const updates = { status }

  if (status === 'DEPARTED') {
    updates.actual_departure = now
    if (latitude) updates.departure_latitude = latitude
    if (longitude) updates.departure_longitude = longitude
    if (loaded_quantity_liters) updates.loaded_quantity_liters = loaded_quantity_liters
  }

  if (status === 'ARRIVED') {
    updates.actual_arrival = now
    if (latitude) updates.arrival_latitude = latitude
    if (longitude) updates.arrival_longitude = longitude
  }

  if (status === 'COMPLETED') {
    if (received_quantity_liters) updates.received_quantity_liters = received_quantity_liters
  }

  const { data, error } = await supabase
    .from('fuel_loads')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return errorResponse(res, 500, error.message)
  return successResponse(res, data)
}
