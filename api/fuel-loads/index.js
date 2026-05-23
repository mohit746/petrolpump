// api/fuel-loads/index.js
import { createClient } from '../_lib/supabase.js'
import { authenticate, errorResponse, successResponse } from '../_lib/utils.js'

function generateTripNumber() {
  const now = new Date()
  const y = now.getFullYear()
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `FL-${y}-${rand}`
}

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
      .from('fuel_loads')
      .select(`
        *,
        driver:driver_id (id, first_name, last_name),
        helper:helper_id (id, first_name, last_name)
      `)
      .order('created_at', { ascending: false })

    if (!isAdmin) query = query.eq('driver_id', user.id)

    const { data, error } = await query
    if (error) return errorResponse(res, 500, error.message)
    return successResponse(res, data)
  }

  if (req.method === 'POST') {
    if (!['SUPER_ADMIN', 'ADMIN'].includes(user.role)) return errorResponse(res, 403, 'Forbidden')

    const {
      driver_id, helper_id, vehicle_number, vehicle_type,
      terminal_name, terminal_address,
      fuel_type, ordered_quantity_liters, scheduled_departure,
      delivery_challan_number, gate_pass_number,
    } = req.body

    const { data, error } = await supabase
      .from('fuel_loads')
      .insert({
        trip_number: generateTripNumber(),
        driver_id, helper_id: helper_id || null,
        vehicle_number, vehicle_type,
        terminal_name, terminal_address,
        fuel_type, ordered_quantity_liters,
        scheduled_departure: scheduled_departure || null,
        delivery_challan_number, gate_pass_number,
        status: 'SCHEDULED',
        created_by: user.id,
      })
      .select()
      .single()

    if (error) return errorResponse(res, 500, error.message)
    return successResponse(res, data, 201)
  }

  return errorResponse(res, 405, 'Method not allowed')
}
