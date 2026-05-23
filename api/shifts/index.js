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
      // Start a new shift
      const { readings } = await request.json()

      if (!readings || !Array.isArray(readings) || readings.length === 0) {
        return createError('Initial readings are required to start a shift')
      }

      // Check if user already has an active shift
      const { data: activeShift } = await supabase
        .from('shifts')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'ACTIVE')
        .single()

      if (activeShift) {
        return createError('User already has an active shift')
      }

      // Start transaction by creating shift
      const { data: shift, error: shiftError } = await supabase
        .from('shifts')
        .insert([{
          user_id: user.id,
          start_time: new Date().toISOString(),
          status: 'ACTIVE'
        }])
        .select()
        .single()

      if (shiftError) {
        return createError('Failed to create shift', 500)
      }

      // Insert initial readings
      const readingEntries = readings.map(reading => ({
        dispensing_unit_id: reading.dispensingUnitId,
        shift_id: shift.id,
        previous_reading: reading.previousReading || 0,
        current_reading: reading.currentReading,
        rate_per_liter: reading.ratePerLiter,
        entry_type: 'SHIFT_START',
        entered_by: user.id
      }))

      const { error: readingsError } = await supabase
        .from('reading_entries')
        .insert(readingEntries)

      if (readingsError) {
        // Rollback: delete the shift if readings insertion fails
        await supabase.from('shifts').delete().eq('id', shift.id)
        return createError('Failed to record initial readings', 500)
      }

      return createResponse({
        success: true,
        data: { shift, message: 'Shift started successfully' },
      }, 201)
    }

    if (request.method === 'GET') {
      const url = new URL(request.url)
      const action = url.searchParams.get('action')

      if (action === 'current') {
        // Get current active shift for the user
        const { data: shift, error } = await supabase
          .from('shifts')
          .select(`
            *,
            reading_entries (
              *,
              dispensing_units (unit_number, fuel_type)
            )
          `)
          .eq('user_id', user.id)
          .eq('status', 'ACTIVE')
          .single()

        if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
          return createError('Failed to fetch current shift', 500)
        }

        return createResponse({
          success: true,
          data: shift || null,
        })
      }

      // Get all shifts for the user (with pagination)
      const page = parseInt(url.searchParams.get('page')) || 1
      const limit = parseInt(url.searchParams.get('limit')) || 10
      const offset = (page - 1) * limit

      const { data: shifts, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) {
        return createError('Failed to fetch shifts', 500)
      }

      return createResponse({
        success: true,
        data: shifts,
      })
    }

    return createError('Method not allowed', 405)
  } catch (error) {
    console.error('Shifts API error:', error)
    return createError(error.message, 500)
  }
}