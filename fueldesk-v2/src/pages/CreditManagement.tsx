// src/pages/CreditManagement.tsx
import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CreditCard, Plus, ChevronRight, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import useAuthStore from '../stores/useAuthStore'
import { supabase } from '../lib/supabase'
import { formatINR } from '../lib/utils'
import { StatusBadge } from '../components/ui/Badge'
import { Dialog, ConfirmDialog } from '../components/ui/Dialog'
import { SkeletonList } from '../components/ui/SkeletonCard'
import { useToast } from '../components/ui/Toast'
import { useRoleAccess } from '../hooks/useRoleAccess'
import type { CreditAccount } from '../types'

const CreditManagement: React.FC = () => {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { isManagement, isEmployee } = useRoleAccess()
  const [addOpen, setAddOpen] = useState(false)
  const [txOpen, setTxOpen] = useState(false)
  const [selected, setSelected] = useState<CreditAccount | null>(null)
  const [addTxOpen, setAddTxOpen] = useState(false)
  const [search, setSearch] = useState('')

  const { register: regAcc, handleSubmit: subAcc, reset: rstAcc } = useForm<{ customer_name: string; phone: string }>()
  const { register: regTx, handleSubmit: subTx, reset: rstTx } = useForm<{ type: 'CREDIT' | 'PAYMENT'; amount: string; notes: string }>()

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['credit_accounts', user?.pump_id],
    queryFn: async () => {
      const { data } = await supabase.from('credit_accounts').select('*')
        .eq('pump_id', user!.pump_id!)
        .order('customer_name')
      return data as CreditAccount[]
    },
    enabled: !!user?.pump_id,
  })

  const { data: transactions } = useQuery({
    queryKey: ['credit_tx', selected?.id],
    queryFn: async () => {
      const { data } = await supabase.from('credit_transactions').select('*').eq('account_id', selected!.id).order('transaction_date', { ascending: false })
      return data ?? []
    },
    enabled: !!selected?.id,
  })

  const addAccMutation = useMutation({
    mutationFn: async (d: { customer_name: string; phone: string }) => {
      await supabase.from('credit_accounts').insert({ ...d, pump_id: user!.pump_id, outstanding_balance: 0, is_active: true })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['credit_accounts'] }); toast('Account created', 'success'); setAddOpen(false); rstAcc() },
    onError: () => toast('Failed to create account', 'error'),
  })

  const addTxMutation = useMutation({
    mutationFn: async (d: { type: string; amount: string; notes: string }) => {
      const amt = parseFloat(d.amount)
      if (!amt || amt <= 0) throw new Error('Amount must be greater than zero')

      await supabase.from('credit_transactions').insert({
        account_id: selected!.id, pump_id: user!.pump_id, amount: amt,
        type: d.type, entered_by: user!.id, status: 'PENDING',
        transaction_date: new Date().toISOString(), notes: d.notes,
      })

      // Recompute outstanding_balance from the source of truth (transactions)
      // instead of using stale client-side state. This avoids race conditions
      // when two users record transactions simultaneously.
      const { data: tx } = await supabase
        .from('credit_transactions')
        .select('type, amount')
        .eq('account_id', selected!.id)
        .neq('status', 'REJECTED')

      const newBalance = (tx ?? []).reduce(
        (sum: number, t: { type: string; amount: number }) =>
          sum + (t.type === 'CREDIT' ? Number(t.amount) : -Number(t.amount)),
        0,
      )

      await supabase
        .from('credit_accounts')
        .update({ outstanding_balance: newBalance })
        .eq('id', selected!.id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit_accounts'] })
      qc.invalidateQueries({ queryKey: ['credit_tx'] })
      toast('Transaction recorded', 'success'); setAddTxOpen(false); rstTx()
    },
    onError: () => toast('Failed to record transaction', 'error'),
  })

  const filtered = (accounts ?? []).filter((a: CreditAccount) =>
    a.customer_name.toLowerCase().includes(search.toLowerCase()) || a.phone.includes(search)
  )

  if (isLoading) return <div className="p-4"><SkeletonList /></div>

  return (
    <div className="p-4 space-y-4">
      {isManagement && (
        <button onClick={() => setAddOpen(true)} className="btn-primary w-full">
          <Plus className="w-4 h-4" /> Add Credit Account
        </button>
      )}

      <input type="search" placeholder="Search customer…" value={search}
        onChange={e => setSearch(e.target.value)} className="input" />

      <div className="space-y-2">
        {filtered.map((a: CreditAccount) => (
          <div key={a.id}
            className="card flex items-center gap-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
            onClick={() => { setSelected(a); setTxOpen(true) }}>
            <div className="avatar"><CreditCard className="w-4 h-4" /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 dark:text-white">{a.customer_name}</p>
              <p className="text-xs text-slate-400">{a.phone}</p>
            </div>
            <div className="text-right">
              <p className={`text-sm font-bold ${a.outstanding_balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {formatINR(a.outstanding_balance)}
              </p>
              <p className="text-[10px] text-slate-400">Outstanding</p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="card text-center py-10 text-slate-400">
            <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No credit accounts</p>
          </div>
        )}
      </div>

      {/* Add account dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add Credit Account">
        <form onSubmit={subAcc(d => addAccMutation.mutate(d))} className="space-y-4">
          <div>
            <label className="label">Customer Name</label>
            <input className="input" placeholder="Full name" {...regAcc('customer_name', { required: true })} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" placeholder="9876543210" {...regAcc('phone', { required: true })} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAddOpen(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={addAccMutation.isPending} className="btn-primary flex-1">
              {addAccMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Transactions dialog */}
      <Dialog open={txOpen && !!selected} onClose={() => { setTxOpen(false); setSelected(null) }}
        title={selected?.customer_name ?? 'Transactions'} size="lg">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">Outstanding Balance</p>
                <p className={`text-xl font-bold ${selected.outstanding_balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {formatINR(selected.outstanding_balance)}
                </p>
              </div>
              <button onClick={() => setAddTxOpen(true)} className="btn-primary py-2 text-xs">
                <Plus className="w-3 h-3" /> Add Transaction
              </button>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(transactions ?? []).map((t: { id: string; transaction_date: string; type: string; amount: number; status: string }) => (
                <div key={t.id} className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                  <div>
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      {format(new Date(t.transaction_date), 'dd MMM yyyy')}
                    </p>
                    <StatusBadge status={t.type} />
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${t.type === 'CREDIT' ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {t.type === 'CREDIT' ? '+' : '-'}{formatINR(t.amount)}
                    </p>
                    <StatusBadge status={t.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Dialog>

      {/* Add transaction dialog */}
      <Dialog open={addTxOpen} onClose={() => setAddTxOpen(false)} title="Add Transaction" size="sm">
        <form onSubmit={subTx(d => addTxMutation.mutate(d))} className="space-y-4">
          <div>
            <label className="label">Type</label>
            <select className="input" {...regTx('type')}>
              <option value="CREDIT">Credit Given</option>
              <option value="PAYMENT">Payment Received</option>
            </select>
          </div>
          <div>
            <label className="label">Amount (₹)</label>
            <input type="number" className="input" placeholder="0" {...regTx('amount', { required: true })} />
          </div>
          <div>
            <label className="label">Notes</label>
            <input className="input" placeholder="Optional notes" {...regTx('notes')} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAddTxOpen(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={addTxMutation.isPending} className="btn-primary flex-1">
              {addTxMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Record'}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}

export default CreditManagement
