import { verifyAuth, createResponse, createError } from '../_lib/utils.js'
import { supabase } from '../_lib/supabase.js'

export default async function handler(request) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200 })
  }

  if (request.method !== 'POST') {
    return createError('Method not allowed', 405)
  }

  try {
    const user = await verifyAuth(request)
    const { shiftId, finalReadings, cashCollection } = await request.json()

    if (!shiftId || !finalReadings || !cashCollection) {
      return createError('Shift ID, final readings, and cash collection are required')
    }

    // Verify the shift belongs to the user and is active
    const { data: shift, error: shiftError } = await supabase
      .from('shifts')
      .select('*')
      .eq('id', shiftId)
      .eq('user_id', user.id)
      .eq('status', 'ACTIVE')
      .single()

    if (shiftError || !shift) {
      return createError('Active shift not found')
    }

    // Get opening readings for this shift
    const { data: openingReadings, error: openingError } = await supabase
      .from('reading_entries')
      .select('*')
      .eq('shift_id', shiftId)
      .eq('entry_type', 'SHIFT_START')

    if (openingError) {
      return createError('Failed to fetch opening readings', 500)
    }

    // Calculate expected revenue
    let totalExpectedRevenue = 0
    const finalReadingEntries = finalReadings.map(reading => {
      const openingReading = openingReadings.find(
        or => or.dispensing_unit_id === reading.dispensingUnitId
      )
      
      if (!openingReading) {
        throw new Error(`Opening reading not found for dispenser ${reading.dispensingUnitId}`)
      }

      const fuelSold = reading.currentReading - openingReading.current_reading
      const expectedRevenue = fuelSold * reading.ratePerLiter
      totalExpectedRevenue += expectedRevenue

      return {
        dispensing_unit_id: reading.dispensingUnitId,
        shift_id: shiftId,
        previous_reading: openingReading.current_reading,
        current_reading: reading.currentReading,
        rate_per_liter: reading.ratePerLiter,
        entry_type: 'SHIFT_END',
        entered_by: user.id
      }
    })

    // Insert final readings
    const { error: finalReadingsError } = await supabase
      .from('reading_entries')
      .insert(finalReadingEntries)

    if (finalReadingsError) {
      return createError('Failed to record final readings', 500)
    }

    // Insert cash collection record
    const { error: cashError } = await supabase
      .from('cash_collections')
      .insert([{
        shift_id: shiftId,
        total_cash_collected: cashCollection.totalCash,
        expected_cash: totalExpectedRevenue,
        payment_breakdown: cashCollection.breakdown,
        collected_by: user.id,
        notes: cashCollection.notes
      }])

    if (cashError) {
      return createError('Failed to record cash collection', 500)
    }

    // Update shift status to completed
    const { error: updateError } = await supabase
      .from('shifts')
      .update({ 
        status: 'COMPLETED',
        end_time: new Date().toISOString()
      })
      .eq('id', shiftId)

    if (updateError) {
      return createError('Failed to complete shift', 500)
    }

    // Calculate variance for response
    const variance = cashCollection.totalCash - totalExpectedRevenue

    return createResponse({
      success: true,
      data: {
        message: 'Shift completed successfully',
        summary: {
          expectedRevenue: totalExpectedRevenue,
          actualCash: cashCollection.totalCash,
          variance: variance,
          variancePercentage: totalExpectedRevenue > 0 ? ((variance / totalExpectedRevenue) * 100).toFixed(2) : 0
        }
      },
    })
  } catch (error) {
    console.error('End shift error:', error)
    return createError(error.message, 500)
  }
}