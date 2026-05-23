import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import {
  PlusIcon, XMarkIcon, TruckIcon,
  MapPinIcon, CheckCircleIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import useAuthStore from '../stores/useAuthStore'
import { useRoleAccess } from '../hooks/useRoleAccess'

const FUEL_TYPES = ['MS', 'HSD', 'LUBRICANT', 'ENGINE_OIL_2T']
const STATUS_FLOW = ['SCHEDULED', 'DEPARTED', 'ARRIVED', 'COMPLETED']

const statusColors = {
  SCHEDULED: 'bg-blue-100 text-blue-800',
  DEPARTED:  'bg-yellow-100 text-yellow-800',
  ARRIVED:   'bg-orange-100 text-orange-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

// ─── API ──────────────────────────────────────────────────────────────────────
const fetchFuelLoads = async (token) => {
  const res = await fetch('/api/fuel-loads', { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('Failed to fetch fuel loads')
  return res.json()
}

const createFuelLoad = async ({ data, token }) => {
  const res = await fetch('/api/fuel-loads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create fuel load')
  return res.json()
}

const updateStatus = async ({ id, status, geo, token }) => {
  const res = await fetch(`/api/fuel-loads/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status, ...geo }),
  })
  if (!res.ok) throw new Error('Failed to update status')
  return res.json()
}

const getGeoLocation = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported'))
    navigator.geolocation.getCurrentPosition(
      p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      e => reject(new Error(e.message)),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  })

// ─── New Trip Modal ────────────────────────────────────────────────────────────
const NewTripModal = ({ employees, onClose, token }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: { fuel_type: 'HSD' },
  })

  const drivers = employees.filter(e => ['EMPLOYEE', 'ADMIN'].includes(e.role))

  const mutation = useMutation({
    mutationFn: (data) => createFuelLoad({ data, token }),
    onSuccess: () => {
      toast.success(t('fuelLoads.saveSuccess'))
      queryClient.invalidateQueries(['fuel-loads'])
      onClose()
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold text-gray-900">{t('fuelLoads.newTrip')}</h3>
          <button onClick={onClose}><XMarkIcon className="h-6 w-6 text-gray-400 hover:text-gray-600" /></button>
        </div>
        <form onSubmit={handleSubmit(mutation.mutate)} className="p-6 space-y-5">
          {/* Staff */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Staff Assignment</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{t('fuelLoads.driver')} *</label>
                <select {...register('driver_id', { required: t('errors.required') })} className="input">
                  <option value="">— Select Driver —</option>
                  {drivers.map(e => (
                    <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
                  ))}
                </select>
                {errors.driver_id && <p className="text-xs text-red-600 mt-1">{errors.driver_id.message}</p>}
              </div>
              <div>
                <label className="label">{t('fuelLoads.helper')}</label>
                <select {...register('helper_id')} className="input">
                  <option value="">— Optional —</option>
                  {drivers.map(e => (
                    <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Vehicle */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Vehicle</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{t('fuelLoads.vehicle')} *</label>
                <input {...register('vehicle_number', { required: t('errors.required') })} className="input" placeholder="UP32AB1234" />
                {errors.vehicle_number && <p className="text-xs text-red-600 mt-1">{errors.vehicle_number.message}</p>}
              </div>
              <div>
                <label className="label">{t('fuelLoads.vehicleType')}</label>
                <select {...register('vehicle_type')} className="input">
                  <option value="TANKER_10KL">Tanker 10KL</option>
                  <option value="TANKER_20KL">Tanker 20KL</option>
                  <option value="TANKER_40KL">Tanker 40KL</option>
                </select>
              </div>
            </div>
          </div>

          {/* Terminal */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Terminal Details</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{t('fuelLoads.terminal')} *</label>
                <input {...register('terminal_name', { required: t('errors.required') })} className="input" placeholder="IOCL Mathura Terminal" />
                {errors.terminal_name && <p className="text-xs text-red-600 mt-1">{errors.terminal_name.message}</p>}
              </div>
              <div>
                <label className="label">{t('fuelLoads.fuelType')} *</label>
                <select {...register('fuel_type', { required: t('errors.required') })} className="input">
                  {FUEL_TYPES.map(ft => <option key={ft} value={ft}>{ft}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('fuelLoads.orderedQty')} *</label>
                <input type="number" step="0.01"
                  {...register('ordered_quantity_liters', { required: t('errors.required'), min: 0 })}
                  className="input" placeholder="10000"
                />
                {errors.ordered_quantity_liters && <p className="text-xs text-red-600 mt-1">{errors.ordered_quantity_liters.message}</p>}
              </div>
              <div>
                <label className="label">{t('fuelLoads.departure')}</label>
                <input type="datetime-local" {...register('scheduled_departure')} className="input" />
              </div>
              <div>
                <label className="label">{t('fuelLoads.challan')}</label>
                <input {...register('delivery_challan_number')} className="input" />
              </div>
              <div>
                <label className="label">{t('fuelLoads.gatePass')}</label>
                <input {...register('gate_pass_number')} className="input" />
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary">
              {mutation.isPending ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Trip Card ────────────────────────────────────────────────────────────────
const TripCard = ({ trip, token, isAdmin }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [geoLoading, setGeoLoading] = useState(false)

  const currentIdx = STATUS_FLOW.indexOf(trip.status)
  const nextStatus = STATUS_FLOW[currentIdx + 1]

  const statusMutation = useMutation({
    mutationFn: (geo) => updateStatus({ id: trip.id, status: nextStatus, geo, token }),
    onSuccess: () => {
      toast.success(`Status updated to ${nextStatus}`)
      queryClient.invalidateQueries(['fuel-loads'])
    },
    onError: (err) => toast.error(err.message),
  })

  const handleAdvance = async () => {
    setGeoLoading(true)
    try {
      const geo = await getGeoLocation()
      statusMutation.mutate(geo)
    } catch {
      // proceed without geo
      statusMutation.mutate({})
    } finally {
      setGeoLoading(false)
    }
  }

  const actionLabel = {
    DEPARTED:  t('fuelLoads.markDeparted'),
    ARRIVED:   t('fuelLoads.markArrived'),
    COMPLETED: t('fuelLoads.complete'),
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-semibold text-gray-900">{trip.trip_number}</span>
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${statusColors[trip.status]}`}>
                {t(`fuelLoads.${trip.status.toLowerCase()}`)}
              </span>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{trip.fuel_type}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm text-gray-600">
              <span>🚛 {trip.vehicle_number}</span>
              <span>👤 {trip.driver?.first_name} {trip.driver?.last_name}</span>
              {trip.helper && <span>👥 {trip.helper?.first_name} {trip.helper?.last_name}</span>}
              <span>🏭 {trip.terminal_name}</span>
              <span>📦 {Number(trip.ordered_quantity_liters).toLocaleString('en-IN')} L</span>
              {trip.received_quantity_liters && (
                <span>✅ Received: {Number(trip.received_quantity_liters).toLocaleString('en-IN')} L</span>
              )}
              {trip.scheduled_departure && (
                <span>📅 {format(new Date(trip.scheduled_departure), 'dd MMM hh:mm a')}</span>
              )}
              {trip.delivery_challan_number && <span>📄 {trip.delivery_challan_number}</span>}
            </div>
          </div>

          {/* Progress advance button */}
          {isAdmin && nextStatus && trip.status !== 'CANCELLED' && (
            <button
              onClick={handleAdvance}
              disabled={statusMutation.isPending || geoLoading}
              className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50 whitespace-nowrap"
            >
              {geoLoading ? (
                <MapPinIcon className="h-4 w-4 animate-bounce" />
              ) : (
                <CheckCircleIcon className="h-4 w-4" />
              )}
              <span>{actionLabel[nextStatus] || nextStatus}</span>
            </button>
          )}
        </div>

        {/* Status progress bar */}
        <div className="mt-4 flex items-center space-x-1">
          {STATUS_FLOW.map((s, i) => (
            <React.Fragment key={s}>
              <div className={`flex-1 h-1.5 rounded-full ${i <= currentIdx ? 'bg-primary-500' : 'bg-gray-200'}`} />
              {i < STATUS_FLOW.length - 1 && (
                <div className={`h-2 w-2 rounded-full flex-shrink-0 ${i < currentIdx ? 'bg-primary-500' : 'bg-gray-300'}`} />
              )}
            </React.Fragment>
          ))}
        </div>
        <div className="flex justify-between mt-1">
          {STATUS_FLOW.map(s => (
            <span key={s} className="text-[10px] text-gray-400">{s}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
const FuelLoads = () => {
  const { t } = useTranslation()
  const { token } = useAuthStore()
  const { isAdmin } = useRoleAccess()
  const [showModal, setShowModal] = useState(false)
  const [statusFilter, setStatusFilter] = useState('ALL')

  const { data, isLoading } = useQuery({
    queryKey: ['fuel-loads'],
    queryFn: () => fetchFuelLoads(token),
  })

  const { data: empData } = useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const res = await fetch('/api/employees', { headers: { Authorization: `Bearer ${token}` } })
      return res.json()
    },
    enabled: isAdmin,
  })

  const trips = data?.data || []
  const employees = empData?.data || []
  const filtered = statusFilter === 'ALL' ? trips : trips.filter(t => t.status === statusFilter)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('fuelLoads.title')}</h1>
        {isAdmin && (
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center space-x-2">
            <PlusIcon className="h-5 w-5" />
            <span>{t('fuelLoads.newTrip')}</span>
          </button>
        )}
      </div>

      {/* Status filter */}
      <div className="flex space-x-2 overflow-x-auto pb-1">
        {['ALL', ...STATUS_FLOW, 'CANCELLED'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              statusFilter === s ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s === 'ALL' ? t('common.all') : t(`fuelLoads.${s.toLowerCase()}`)}
          </button>
        ))}
      </div>

      {/* Trip list */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border">
            <TruckIcon className="h-12 w-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">{t('fuelLoads.noTrips')}</p>
          </div>
        ) : (
          filtered.map(trip => (
            <TripCard key={trip.id} trip={trip} token={token} isAdmin={isAdmin} />
          ))
        )}
      </div>

      {showModal && (
        <NewTripModal employees={employees} onClose={() => setShowModal(false)} token={token} />
      )}
    </div>
  )
}

export default FuelLoads
