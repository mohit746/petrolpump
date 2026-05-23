import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  CurrencyRupeeIcon, 
  ClockIcon, 
  ExclamationTriangleIcon,
  ArrowTrendingUpIcon 
} from '@heroicons/react/24/outline'
import api from '../utils/api'
import LoadingSpinner from '../components/LoadingSpinner'

const Dashboard = () => {
  const { data: dashboardData, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const response = await api.get('/dashboard/summary')
      return response.data.data
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  if (isLoading) return <LoadingSpinner text="Loading dashboard..." />
  if (error) return <div className="text-danger-600">Error loading dashboard data</div>

  const stats = [
    {
      name: 'Active Shifts',
      value: dashboardData?.activeShifts?.count || 0,
      icon: ClockIcon,
      color: 'bg-blue-500',
    },
    {
      name: 'Today\'s Revenue',
      value: `₹${(dashboardData?.todayStats?.expectedCash || 0).toLocaleString()}`,
      icon: CurrencyRupeeIcon,
      color: 'bg-green-500',
    },
    {
      name: 'Cash Collected',
      value: `₹${(dashboardData?.todayStats?.totalCashCollected || 0).toLocaleString()}`,
      icon: ArrowTrendingUpIcon,
      color: 'bg-purple-500',
    },
    {
      name: 'Variance',
      value: `₹${(dashboardData?.todayStats?.totalVariance || 0).toLocaleString()}`,
      icon: ExclamationTriangleIcon,
      color: (dashboardData?.todayStats?.totalVariance || 0) >= 0 ? 'bg-green-500' : 'bg-red-500',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600">Overview of today's operations</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((item) => (
          <div key={item.name} className="card p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className={`${item.color} p-3 rounded-lg`}>
                  <item.icon className="h-6 w-6 text-white" />
                </div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dt className="text-sm font-medium text-gray-500 truncate">{item.name}</dt>
                <dd className="text-lg font-medium text-gray-900">{item.value}</dd>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Active Shifts */}
      {dashboardData?.activeShifts?.shifts?.length > 0 && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Shifts</h2>
          <div className="space-y-2">
            {dashboardData.activeShifts.shifts.map((shift) => (
              <div key={shift.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="font-medium text-gray-900">{shift.staffName}</span>
                <span className="text-sm text-green-600 font-medium">Active</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fuel Sales Summary */}
      {dashboardData?.fuelSales && Object.keys(dashboardData.fuelSales).length > 0 && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Today's Fuel Sales</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(dashboardData.fuelSales).map(([fuelType, data]) => (
              <div key={fuelType} className="bg-gray-50 p-4 rounded-lg">
                <h3 className="font-medium text-gray-900">{fuelType}</h3>
                <p className="text-sm text-gray-600">{data.totalLiters.toFixed(2)} L</p>
                <p className="text-sm text-gray-600">₹{data.totalRevenue.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alerts */}
      {dashboardData?.alerts?.length > 0 && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Alerts</h2>
          <div className="space-y-3">
            {dashboardData.alerts.map((alert, index) => (
              <div 
                key={index} 
                className={`p-3 rounded-lg border-l-4 ${
                  alert.type === 'excess' ? 'border-yellow-400 bg-yellow-50' : 'border-red-400 bg-red-50'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-medium text-gray-900">{alert.staffName}</p>
                    <p className="text-sm text-gray-600">
                      {alert.type === 'excess' ? 'Excess' : 'Shortage'}: ₹{Math.abs(alert.variance).toLocaleString()} 
                      ({alert.variancePercentage}%)
                    </p>
                  </div>
                  <span className="text-sm text-gray-500">
                    {new Date(alert.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <button className="btn-primary">Start New Shift</button>
          <button className="btn-secondary">Add Reading</button>
          <button className="btn-secondary">View Reports</button>
        </div>
      </div>
    </div>
  )
}

export default Dashboard