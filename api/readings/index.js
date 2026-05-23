import { verifyAuth, createResponse, createError } from '../_lib/utils.js'
import { supabase } from '../_lib/supabase.js'

export default async function handler(request) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200 })
  }

  try {
    const user = await verifyAuth(request)

    if (request.method === 'POST') {
      // Add intermediate reading entry
      const { dispensingUnitId, currentReading, ratePerLiter, notes } = await request.json()

      if (!dispensingUnitId || currentReading === undefined || !ratePerLiter) {
        return createError('Dispensing unit ID, current reading, and rate per liter are required')
      }

      // Get user's active shift
      const { data: activeShift, error: shiftError } = await supabase
        .from('shifts')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'ACTIVE')
        .single()

      if (shiftError || !activeShift) {
        return createError('No active shift found. Please start a shift first.')
      }

      // Get the latest reading for this dispenser in this shift
      const { data: latestReading, error: readingError } = await supabase
        .from('reading_entries')
        .select('current_reading')
        .eq('dispensing_unit_id', dispensingUnitId)
        .eq('shift_id', activeShift.id)
        .order('timestamp', { ascending: false })
        .limit(1)
        .single()

      if (readingError) {
        return createError('Failed to fetch previous reading', 500)
      }

      // Insert new reading entry
      const { data: reading, error: insertError } = await supabase
        .from('reading_entries')
        .insert([{
          dispensing_unit_id: dispensingUnitId,
          shift_id: activeShift.id,
          previous_reading: latestReading.current_reading,
          current_reading: currentReading,
          rate_per_liter: ratePerLiter,
          entry_type: 'INTERMEDIATE',
          entered_by: user.id,
          notes
        }])
        .select(`
          *,
          dispensing_units (unit_number, fuel_type)
        `)
        .single()

      if (insertError) {
        return createError('Failed to record reading', 500)
      }

      return createResponse({
        success: true,
        data: reading,
      }, 201)
    }

    if (request.method === 'GET') {
      const url = new URL(request.url)
      const dispenserId = url.searchParams.get('dispenser_id')
      const shiftId = url.searchParams.get('shift_id')
      const type = url.searchParams.get('type')

      let query = supabase
        .from('reading_entries')
        .select(`
          *,
          dispensing_units (unit_number, fuel_type),
          users (first_name, last_name)
        `)
        .order('timestamp', { ascending: false })

      if (dispenserId) {
        query = query.eq('dispensing_unit_id', dispenserId)
      }

      if (shiftId) {
        query = query.eq('shift_id', shiftId)
      }

      if (type) {
        query = query.eq('entry_type', type)
      }

      // Limit results for performance
      const limit = parseInt(url.searchParams.get('limit')) || 50
      query = query.limit(limit)

      const { data: readings, error } = await query

      if (error) {
        return createError('Failed to fetch readings', 500)
      }

      return createResponse({
        success: true,
        data: readings,
      })
    }

    return createError('Method not allowed', 405)
  } catch (error) {
    console.error('Readings API error:', error)
    return createError(error.message, 500)
  }
}