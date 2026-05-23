import { verifyAuth, createResponse, createError } from '../_lib/utils.js'
import { supabase } from '../_lib/supabase.js'

export default async function handler(request) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200 })
  }

  if (request.method !== 'GET') {
    return createError('Method not allowed', 405)
  }

  try {
    const user = await verifyAuth(request)

    // Get today's date for filtering
    const today = new Date().toISOString().split('T')[0]

    // Get active shifts count
    const { data: activeShifts, error: activeShiftsError } = await supabase
      .from('shifts')
      .select('id, users(first_name, last_name)')
      .eq('status', 'ACTIVE')

    if (activeShiftsError) {
      return createError('Failed to fetch active shifts', 500)
    }

    // Get today's completed shifts
    const { data: todayShifts, error: todayShiftsError } = await supabase
      .from('shifts')
      .select('id')
      .eq('status', 'COMPLETED')
      .gte('start_time', `${today}T00:00:00`)
      .lt('start_time', `${today}T23:59:59`)

    if (todayShiftsError) {
      return createError('Failed to fetch today shifts', 500)
    }

    // Get today's cash collections and calculate totals
    const { data: cashCollections, error: cashError } = await supabase
      .from('cash_collections')
      .select('total_cash_collected, expected_cash, variance')
      .gte('timestamp', `${today}T00:00:00`)
      .lt('timestamp', `${today}T23:59:59`)

    if (cashError) {
      return createError('Failed to fetch cash collections', 500)
    }

    // Calculate today's totals
    const todayTotals = cashCollections.reduce(
      (acc, collection) => ({
        totalCash: acc.totalCash + Number(collection.total_cash_collected),
        expectedCash: acc.expectedCash + Number(collection.expected_cash),
        totalVariance: acc.totalVariance + Number(collection.variance),
      }),
      { totalCash: 0, expectedCash: 0, totalVariance: 0 }
    )

    // Get fuel sales summary for today
    const { data: fuelSales, error: fuelError } = await supabase
      .from('reading_entries')
      .select(`
        fuel_sold,
        expected_revenue,
        dispensing_units(fuel_type)
      `)
      .eq('entry_type', 'SHIFT_END')
      .gte('timestamp', `${today}T00:00:00`)
      .lt('timestamp', `${today}T23:59:59`)

    if (fuelError) {
      return createError('Failed to fetch fuel sales', 500)
    }

    // Group fuel sales by type
    const fuelSummary = fuelSales.reduce((acc, sale) => {
      const fuelType = sale.dispensing_units.fuel_type
      if (!acc[fuelType]) {
        acc[fuelType] = { totalLiters: 0, totalRevenue: 0 }
      }
      acc[fuelType].totalLiters += Number(sale.fuel_sold)
      acc[fuelType].totalRevenue += Number(sale.expected_revenue)
      return acc
    }, {})

    // Get recent high variances (alerts)
    const { data: alerts, error: alertsError } = await supabase
      .from('cash_collections')
      .select(`
        variance,
        expected_cash,
        timestamp,
        shifts(users(first_name, last_name))
      `)
      .gte('timestamp', `${today}T00:00:00`)
      .lt('timestamp', `${today}T23:59:59`)
      .order('timestamp', { ascending: false })
      .limit(10)

    if (alertsError) {
      return createError('Failed to fetch alerts', 500)
    }

    // Filter high variance alerts (more than 5% difference)
    const highVarianceAlerts = alerts
      .filter(alert => {
        const variancePercentage = Math.abs((Number(alert.variance) / Number(alert.expected_cash)) * 100)
        return variancePercentage > 5
      })
      .map(alert => ({
        variance: Number(alert.variance),
        expectedCash: Number(alert.expected_cash),
        variancePercentage: ((Number(alert.variance) / Number(alert.expected_cash)) * 100).toFixed(2),
        timestamp: alert.timestamp,
        staffName: `${alert.shifts.users.first_name} ${alert.shifts.users.last_name}`,
        type: Number(alert.variance) > 0 ? 'excess' : 'shortage'
      }))

    return createResponse({
      success: true,
      data: {
        activeShifts: {
          count: activeShifts.length,
          shifts: activeShifts.map(shift => ({
            id: shift.id,
            staffName: `${shift.users.first_name} ${shift.users.last_name}`
          }))
        },
        todayStats: {
          completedShifts: todayShifts.length,
          totalCashCollected: todayTotals.totalCash,
          expectedCash: todayTotals.expectedCash,
          totalVariance: todayTotals.totalVariance,
          variancePercentage: todayTotals.expectedCash > 0 
            ? ((todayTotals.totalVariance / todayTotals.expectedCash) * 100).toFixed(2)
            : '0.00'
        },
        fuelSales: fuelSummary,
        alerts: highVarianceAlerts,
        lastUpdated: new Date().toISOString()
      },
    })
  } catch (error) {
    console.error('Dashboard API error:', error)
    return createError(error.message, 500)
  }
}