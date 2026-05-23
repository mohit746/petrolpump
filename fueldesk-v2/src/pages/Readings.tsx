// src/pages/Readings.tsx
import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Lock, Save, Loader2, Wrench } from 'lucide-react'
import { format } from 'date-fns'
import useAuthStore from '../stores/useAuthStore'
import { supabase } from '../lib/supabase'
import { formatINR } from '../lib/utils'
import { useToast } from '../components/ui/Toast'
import { useRoleAccess } from '../hooks/useRoleAccess'

// Legacy fallback layout used when no nozzles are configured under
// /machines yet. New deployments seed the catalog via seed_pump_defaults().
const LEGACY_NOZZLES: NozzleSpec[] = Array.from({ length: 8 }, (_, i) => ({
  key: `legacy-${i + 1}`,
  number: i + 1,
  label: `Nozzle ${i + 1}`,
  fuel_code: i < 4 ? 'MS' : 'HSD',
}))

interface NozzleSpec {
  // Stable client-side key for the React row.
  key: string
  // Legacy `nozzle_number` value, persisted in nozzle_readings rows.
  number: number
  // Display label.
  label: string
  // Code from the fuel_types catalog. Legacy rows use 'MS' / 'HSD' literals.
  fuel_code: string
}

const Readings: React.FC = () => {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const { toast } = useToast()
  const navigate = useNavigate()
  const { isManagement } = useRoleAccess()
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [readings, setReadings] = useState<Record<number, string>>({})
  const [cash, setCash] = useState({ actual: '', online: '', credit: '' })
  const today = format(new Date(), 'yyyy-MM-dd')

  // ── Dynamic nozzles from the catalog. Falls back to legacy 8 if empty. ──
  // Supabase's generated types treat embedded relations as arrays, but at
  // runtime PostgREST returns a single object for a one-to-one foreign key.
  // We narrow that locally with a typed helper.
  type CatalogNozzle = {
    id: string
    code: string
    display_order: number
    machine_id: string
    fuel_type_id: string
    machines: { code: string; display_order: number; is_active: boolean } | null
    fuel_types: { code: string } | null
  }

  const { data: catalogNozzles } = useQuery({
    queryKey: ['nozzles_for_readings', user?.pump_id],
    queryFn: async (): Promise<CatalogNozzle[]> => {
      const { data, error } = await supabase
        .from('nozzles')
        .select('id, code, display_order, machine_id, fuel_type_id, machines(code, display_order, is_active), fuel_types(code)')
        .eq('pump_id', user!.pump_id!)
        .eq('is_active', true)
      if (error) throw new Error(error.message)
      // The runtime shape is a single object per relation; cast through unknown
      // because the generated type defaults to arrays.
      return (data ?? []) as unknown as CatalogNozzle[]
    },
    enabled: !!user?.pump_id,
  })

  // Project the catalog into stable NozzleSpec rows, sorted by machine then
  // nozzle order. Each is assigned a synthetic `nozzle_number` so the
  // legacy `nozzle_readings(pump_id, nozzle_number, reading_date)` unique
  // index keeps working without schema churn.
  const nozzles: NozzleSpec[] = useMemo(() => {
    if (!catalogNozzles || catalogNozzles.length === 0) return LEGACY_NOZZLES
    const visible = catalogNozzles.filter(n => n.machines?.is_active !== false)
    const sorted = [...visible].sort((a, b) => {
      const am = a.machines?.display_order ?? 0
      const bm = b.machines?.display_order ?? 0
      if (am !== bm) return am - bm
      return a.display_order - b.display_order
    })
    return sorted.map((n, i) => ({
      key: n.id,
      number: i + 1,
      label: `${n.machines?.code ?? '?'} / ${n.code}`,
      fuel_code: n.fuel_types?.code ?? '?',
    }))
  }, [catalogNozzles])
  const usingCatalog = (catalogNozzles?.length ?? 0) > 0

  // Previous-day closing readings.
  //
  // On catalog mode we key by `nozzle_id` because synthetic `nozzle_number`
  // values can shift when a super admin reorders or deactivates a nozzle.
  // On legacy mode (no catalog rows) we key by `nozzle_number` as before.
  //
  // The query returns BOTH maps; the UI picks the right one per nozzle.
  const { data: prevReadings } = useQuery({
    queryKey: ['prev_readings', user?.pump_id, date, usingCatalog],
    queryFn: async () => {
      const prev = new Date(date); prev.setDate(prev.getDate() - 1)
      const prevDate = prev.toISOString().split('T')[0]
      const { data } = await supabase.from('nozzle_readings')
        .select('nozzle_id, nozzle_number, closing_reading')
        .eq('pump_id', user!.pump_id!)
        .eq('reading_date', prevDate)
      const byId: Record<string, number> = {}
      const byNumber: Record<number, number> = {}
      ;(data ?? []).forEach((r: { nozzle_id: string | null; nozzle_number: number; closing_reading: number }) => {
        if (r.nozzle_id) byId[r.nozzle_id] = r.closing_reading
        if (typeof r.nozzle_number === 'number') byNumber[r.nozzle_number] = r.closing_reading
      })
      return { byId, byNumber }
    },
    enabled: !!user?.pump_id,
  })

  // Stable per-nozzle lookup of the previous closing reading.
  // Catalog rows resolve via nozzle_id; legacy fallback rows fall back to
  // nozzle_number.
  const prevFor = (n: NozzleSpec): number => {
    if (!prevReadings) return 0
    if (usingCatalog) {
      // n.key is the catalog nozzle UUID for catalog rows. The legacy entries
      // use 'legacy-N' keys which won't match anything in byId, so they
      // correctly fall through to byNumber.
      return prevReadings.byId[n.key] ?? prevReadings.byNumber[n.number] ?? 0
    }
    return prevReadings.byNumber[n.number] ?? 0
  }

  // Pricing source of truth: fuel_prices (currently effective row, i.e.
  // effective_to IS NULL). Falls back to system_settings.{ms_rate,hsd_rate}
  // for pumps that haven't migrated to the catalog yet so the legacy
  // hard-coded layout still produces a sensible "expected cash" value.
  const { data: rates } = useQuery({
    queryKey: ['fuel_rates', user?.pump_id],
    queryFn: async () => {
      const map: Record<string, number> = {}

      // 1. Catalog-driven prices.
      const { data: priceRows } = await supabase
        .from('fuel_prices')
        .select('selling_price, fuel_types!inner(code)')
        .eq('pump_id', user!.pump_id!)
        .is('effective_to', null)
      ;(priceRows ?? []).forEach((r) => {
        // Supabase typegen exposes embedded relations as arrays; runtime
        // gives a single object. Narrow defensively.
        const ft = (r as unknown as { fuel_types: { code: string } | { code: string }[] | null }).fuel_types
        const code = Array.isArray(ft) ? ft[0]?.code : ft?.code
        const price = (r as unknown as { selling_price: number }).selling_price
        if (code && typeof price === 'number') map[code] = price
      })

      // 2. Legacy fallback. Only fills MS / HSD if not already in the map.
      const { data: legacyRows } = await supabase
        .from('system_settings')
        .select('key,value')
        .eq('pump_id', user!.pump_id!)
        .in('key', ['ms_rate', 'hsd_rate'])
      ;(legacyRows ?? []).forEach((r: { key: string; value: string }) => {
        const n = parseFloat(r.value)
        if (Number.isNaN(n)) return
        if (r.key === 'ms_rate'  && map.MS  === undefined) map.MS  = n
        if (r.key === 'hsd_rate' && map.HSD === undefined) map.HSD = n
      })

      return map
    },
    enabled: !!user?.pump_id,
  })

  const { data: daySales } = useQuery({
    queryKey: ['day_sales', user?.pump_id, date],
    queryFn: async () => {
      const { data } = await supabase.from('daily_sales').select('*').eq('pump_id', user!.pump_id!).eq('sale_date', date).maybeSingle()
      return data
    },
    enabled: !!user?.pump_id,
  })

  // Per-nozzle revenue / COGS / profit for the selected date.
  // Pulled from public.v_readings_priced — values are computed against
  // fuel_prices.effective_from at created_at, never re-priced retroactively.
  type PricedRow = {
    reading_id: string
    nozzle_id: string | null
    nozzle_number: number
    fuel_type: string
    litres_sold: number
    revenue: number | null
    cogs: number | null
    profit: number | null
  }
  const { data: pricedRows } = useQuery({
    queryKey: ['readings_priced', user?.pump_id, date],
    queryFn: async (): Promise<PricedRow[]> => {
      const { data, error } = await supabase
        .from('v_readings_priced')
        .select('reading_id, nozzle_id, nozzle_number, fuel_type, litres_sold, revenue, cogs, profit')
        .eq('pump_id', user!.pump_id!)
        .eq('reading_date', date)
      if (error) {
        console.warn('[Readings] v_readings_priced lookup failed:', error.message)
        return []
      }
      return (data ?? []) as PricedRow[]
    },
    enabled: !!user?.pump_id,
  })

  // Per-fuel litres summed across the active nozzle set. Pricing is keyed on
  // fuel_code so the catalog can introduce CNG/XP/etc. without code changes.
  const litresByFuel: Record<string, number> = useMemo(() => {
    const tally: Record<string, number> = {}
    for (const n of nozzles) {
      const prev = prevFor(n)
      const curr = parseFloat(readings[n.number] ?? '0')
      const sold = Math.max(0, curr - prev)
      if (sold === 0) continue
      tally[n.fuel_code] = (tally[n.fuel_code] ?? 0) + sold
    }
    return tally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nozzles, readings, prevReadings, usingCatalog])

  const msLitres  = litresByFuel.MS  ?? 0
  const hsdLitres = litresByFuel.HSD ?? 0

  const expectedCash = useMemo(() => {
    let total = 0
    for (const [code, litres] of Object.entries(litresByFuel)) {
      total += litres * (rates?.[code] ?? 0)
    }
    return total
  }, [litresByFuel, rates])
  // Credit GIVEN reduces the cash you actually owe to collect.
  // Cash you must physically take in = total expected − credit given.
  // Shortfall = (cash + online) − cashExpected. Positive = surplus, negative = short.
  const creditGiven = parseFloat(cash.credit) || 0
  const cashIn      = parseFloat(cash.actual) || 0
  const onlineIn    = parseFloat(cash.online) || 0
  const cashExpected = Math.max(0, expectedCash - creditGiven)
  const shortfall = (cashIn + onlineIn) - cashExpected

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Hard lock-guard: re-check the day's lock status against the database
      // immediately before writing. React state can lag (toast on save in
      // another tab, or a stale persisted query result) and a locked day
      // must never accept new readings, even if the buttons render briefly.
      const { data: locked, error: lockErr } = await supabase.rpc('day_close_locked', {
        p_pump_id: user!.pump_id, p_date: date,
      })
      if (lockErr) {
        // Fall back to the in-cache flag rather than blocking — the function
        // may not be deployed on every environment yet.
        if (daySales?.is_locked) throw new Error('Day is locked. Unlock to edit.')
      } else if (locked === true) {
        throw new Error('Day is locked. Unlock to edit.')
      }

      // Catalog rows carry a real nozzle_id; legacy fallback rows do not.
      // We split the upsert into two batches because the conflict key
      // differs between them.
      const catalogRows: Array<Record<string, unknown>> = []
      const legacyRows:  Array<Record<string, unknown>> = []
      for (const n of nozzles) {
        const prev = prevFor(n)
        const closingStr = readings[n.number] ?? ''
        // Don't write a row that has no closing reading entered AND no prior
        // history — saves keystrokes on first-time setup of a new nozzle.
        if (closingStr === '' && prev === 0) continue

        const closing = parseFloat(closingStr || '0')
        const row = {
          pump_id: user!.pump_id,
          nozzle_number: n.number,
          // The legacy column is constrained to 'MS' | 'HSD' in some pumps;
          // catalog rows may carry other codes (CNG, XP).
          fuel_type: n.fuel_code,
          reading_date: date,
          opening_reading: prev,
          closing_reading: closing,
          litres_sold: Math.max(0, closing - prev),
          entered_by: user!.id,
        }
        // Catalog row keys begin with the nozzle's UUID; legacy rows use
        // 'legacy-N'. Distinguish by usingCatalog flag so a partially
        // configured pump still works.
        if (usingCatalog && !n.key.startsWith('legacy-')) {
          catalogRows.push({ ...row, nozzle_id: n.key })
        } else {
          legacyRows.push(row)
        }
      }

      if (catalogRows.length > 0) {
        const { error } = await supabase
          .from('nozzle_readings')
          .upsert(catalogRows, { onConflict: 'pump_id,nozzle_id,reading_date' })
        if (error) throw new Error(error.message)
      }
      if (legacyRows.length > 0) {
        const { error } = await supabase
          .from('nozzle_readings')
          .upsert(legacyRows, { onConflict: 'pump_id,nozzle_number,reading_date' })
        if (error) throw new Error(error.message)
      }

      const { error: salesErr } = await supabase.from('daily_sales').upsert({
        pump_id: user!.pump_id, sale_date: date,
        total_ms_litres: msLitres, total_hsd_litres: hsdLitres,
        total_expected_cash: expectedCash,
        cash_collected: parseFloat(cash.actual) || 0,
        online_collected: parseFloat(cash.online) || 0,
        credit_given: parseFloat(cash.credit) || 0,
        shortfall,
      }, { onConflict: 'pump_id,sale_date' })
      if (salesErr) throw new Error(salesErr.message)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['day_sales'] })
      qc.invalidateQueries({ queryKey: ['prev_readings'] })
      qc.invalidateQueries({ queryKey: ['readings_priced'] })
      qc.invalidateQueries({ queryKey: ['day_profit'] })
      toast('Readings saved', 'success')
      if (shortfall < -500) toast(`Cash shortfall: ${formatINR(Math.abs(shortfall))}`, 'warning')
    },
    onError: (e: Error) => toast(e.message || 'Failed to save readings', 'error'),
  })

  const lockMutation = useMutation({
    mutationFn: async () => {
      await supabase.from('daily_sales').update({ is_locked: true }).eq('pump_id', user!.pump_id!).eq('sale_date', date)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['day_sales'] }); toast('Day locked', 'success') },
  })

  const isLocked = daySales?.is_locked

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <input type="date" value={date} max={today}
          onChange={e => setDate(e.target.value)}
          className="input flex-1" />
        {isLocked && (
          <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-lg">
            <Lock className="w-3 h-3" /> Locked
          </span>
        )}
      </div>

      {/* Tells super admin where to set up nozzles when running on the
          legacy fallback layout. */}
      {!usingCatalog && isManagement && (
        <div className="card flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          <Wrench className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <div className="flex-1 text-xs text-amber-800 dark:text-amber-300">
            Showing the default 8-nozzle layout. Configure your real machines &amp; nozzles
            so readings, sales and pricing reflect this pump.
          </div>
          <button onClick={() => navigate('/machines')} className="btn-secondary text-xs px-2 py-1">
            Set up
          </button>
        </div>
      )}

      {/* Nozzle grid */}
      <div className="grid grid-cols-2 gap-3">
        {nozzles.map(n => {
          const prev = prevFor(n)
          const curr = parseFloat(readings[n.number] ?? '0')
          const sold = Math.max(0, curr - prev)
          const fuelBadge = n.fuel_code === 'HSD' ? 'badge-blue' : 'badge-green'
          return (
            <div key={n.key} className="card space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 dark:text-white text-sm truncate">{n.label}</span>
                <span className={`badge text-xs ${fuelBadge}`}>{n.fuel_code}</span>
              </div>
              <div>
                <label className="label text-[10px]">Previous Reading</label>
                <input className="input text-sm bg-slate-50 dark:bg-slate-700" value={prev} disabled />
              </div>
              <div>
                <label className="label text-[10px]">Today's Reading</label>
                <input
                  type="number" className="input text-sm" placeholder="0"
                  value={readings[n.number] ?? ''} disabled={!!isLocked}
                  onChange={e => setReadings(r => ({ ...r, [n.number]: e.target.value }))}
                />
              </div>
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] text-slate-400">Litres Sold</span>
                <span className="text-sm font-semibold text-emerald-600">{sold.toFixed(1)}L</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Daily totals */}
      <div className="card space-y-3">
        <p className="section-title">Daily Totals</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-2.5">
            <p className="text-[10px] text-emerald-600 uppercase font-medium">MS Litres</p>
            <p className="text-base font-bold text-emerald-700">{msLitres.toFixed(1)}L</p>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2.5">
            <p className="text-[10px] text-blue-600 uppercase font-medium">HSD Litres</p>
            <p className="text-base font-bold text-blue-700">{hsdLitres.toFixed(1)}L</p>
          </div>
        </div>
        <div className="border-t border-slate-100 dark:border-slate-700 pt-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Expected Cash</span>
            <span className="font-semibold">{formatINR(expectedCash)}</span>
          </div>
          <div>
            <label className="label text-xs">Actual Cash</label>
            <input type="number" className="input" placeholder="0" value={cash.actual}
              disabled={!!isLocked} onChange={e => setCash(c => ({ ...c, actual: e.target.value }))} />
          </div>
          <div>
            <label className="label text-xs">Online Collected</label>
            <input type="number" className="input" placeholder="0" value={cash.online}
              disabled={!!isLocked} onChange={e => setCash(c => ({ ...c, online: e.target.value }))} />
          </div>
          <div>
            <label className="label text-xs">Credit Given</label>
            <input type="number" className="input" placeholder="0" value={cash.credit}
              disabled={!!isLocked} onChange={e => setCash(c => ({ ...c, credit: e.target.value }))} />
          </div>
          <div className={`flex justify-between text-sm font-semibold p-2.5 rounded-lg ${shortfall >= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/20'}`}>
            <span>Shortfall</span>
            <span>{formatINR(Math.abs(shortfall))} {shortfall >= 0 ? 'surplus' : 'short'}</span>
          </div>
        </div>
      </div>

      {/* Priced breakdown — management only, only when there's saved data.
          Numbers come from public.v_readings_priced (price-at-the-time
          times litres). Never show this to employees; profit is admin info. */}
      {isManagement && (pricedRows ?? []).length > 0 && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <p className="section-title">Priced Breakdown</p>
            <span className="text-[10px] text-slate-400">historical price</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-[10px] uppercase font-medium">
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 py-1.5">
              <p className="text-emerald-600">Revenue</p>
              <p className="text-sm font-bold text-emerald-700 normal-case">
                {formatINR((pricedRows ?? []).reduce((s, r) => s + (Number(r.revenue) || 0), 0))}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800 py-1.5">
              <p className="text-slate-500">COGS</p>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200 normal-case">
                {formatINR((pricedRows ?? []).reduce((s, r) => s + (Number(r.cogs) || 0), 0))}
              </p>
            </div>
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 py-1.5">
              <p className="text-blue-600">Profit</p>
              <p className="text-sm font-bold text-blue-700 normal-case">
                {formatINR((pricedRows ?? []).reduce((s, r) => s + (Number(r.profit) || 0), 0))}
              </p>
            </div>
          </div>
          <div className="text-xs space-y-1 max-h-48 overflow-y-auto pt-1">
            {(pricedRows ?? []).map(r => (
              <div key={r.reading_id}
                   className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 last:border-0 py-1">
                <span className="text-slate-600 dark:text-slate-300 truncate">
                  N{r.nozzle_number} · {r.fuel_type} · {Number(r.litres_sold ?? 0).toFixed(1)}L
                </span>
                <span className="font-medium text-slate-800 dark:text-white">
                  {formatINR(Number(r.revenue) || 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isLocked && (
        <div className="flex gap-2">
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="btn-primary flex-1">
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Save Readings</>}
          </button>
          {isManagement && daySales && (
            <button onClick={() => lockMutation.mutate()} disabled={lockMutation.isPending}
              className="btn-secondary px-3">
              <Lock className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default Readings
