import { verifyAuth, createResponse, createError, requireRole } from '../_lib/utils.js'
import { supabase } from '../_lib/supabase.js'

export default async function handler(request) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200 })
  }

  try {
    const user = await verifyAuth(request)

    if (request.method === 'GET') {
      // Get all dispensing units
      const { data: dispensers, error } = await supabase
        .from('dispensing_units')
        .select('*')
        .order('unit_number')

      if (error) {
        return createError('Failed to fetch dispensers', 500)
      }

      return createResponse({
        success: true,
        data: dispensers,
      })
    }

    if (request.method === 'POST') {
      // Only managers and above can create dispensers
      requireRole(['OWNER', 'MANAGER'])(user)

      const { unitNumber, fuelType, ratePerLiter, description } = await request.json()

      if (!unitNumber || !fuelType || !ratePerLiter) {
        return createError('Unit number, fuel type, and rate per liter are required')
      }

      const { data: dispenser, error } = await supabase
        .from('dispensing_units')
        .insert([{
          unit_number: unitNumber,
          fuel_type: fuelType,
          rate_per_liter: ratePerLiter,
          description,
          created_by: user.id,
        }])
        .select()
        .single()

      if (error) {
        if (error.code === '23505') { // Unique constraint violation
          return createError('Dispenser unit number already exists')
        }
        return createError('Failed to create dispenser', 500)
      }

      return createResponse({
        success: true,
        data: dispenser,
      }, 201)
    }

    if (request.method === 'PUT') {
      // Only managers and above can update dispensers
      requireRole(['OWNER', 'MANAGER'])(user)

      const url = new URL(request.url)
      const dispenserId = url.searchParams.get('id')

      if (!dispenserId) {
        return createError('Dispenser ID is required')
      }

      const updates = await request.json()
      const allowedFields = ['unit_number', 'fuel_type', 'rate_per_liter', 'description', 'is_active']
      const updateData = {}

      // Only allow specific fields to be updated
      Object.keys(updates).forEach(key => {
        if (allowedFields.includes(key)) {
          updateData[key] = updates[key]
        }
      })

      const { data: dispenser, error } = await supabase
        .from('dispensing_units')
        .update(updateData)
        .eq('id', dispenserId)
        .select()
        .single()

      if (error) {
        return createError('Failed to update dispenser', 500)
      }

      return createResponse({
        success: true,
        data: dispenser,
      })
    }

    return createError('Method not allowed', 405)
  } catch (error) {
    console.error('Dispensers API error:', error)
    return createError(error.message, error.message.includes('permissions') ? 403 : 500)
  }
}