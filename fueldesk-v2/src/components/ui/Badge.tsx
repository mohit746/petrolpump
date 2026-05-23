// src/components/ui/Badge.tsx
import React from 'react'
import { cn } from '../../lib/utils'

export type BadgeVariant = 'green' | 'red' | 'blue' | 'amber' | 'gray' | 'purple' | 'success' | 'destructive' | 'secondary'
interface BadgeProps { label?: string; children?: React.ReactNode; variant?: BadgeVariant; className?: string }

export const Badge: React.FC<BadgeProps> = ({ label, children, variant = 'gray', className }) => {
  const normalise = (v: BadgeVariant) => {
    if (v === 'success') return 'green'
    if (v === 'destructive') return 'red'
    if (v === 'secondary') return 'gray'
    return v
  }
  const variants: Record<string, string> = {
    green:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    red:    'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    blue:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    amber:  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    gray:   'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  }
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', variants[normalise(variant)], className)}>
      {children ?? label}
    </span>
  )
}

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const map: Record<string, { label: string; variant: BadgeVariant }> = {
    ACTIVE:   { label: 'Active', variant: 'green' },
    INACTIVE: { label: 'Inactive', variant: 'gray' },
    PRESENT:  { label: 'Present', variant: 'green' },
    ABSENT:   { label: 'Absent', variant: 'red' },
    LATE:     { label: 'Late', variant: 'amber' },
    HALF_DAY: { label: 'Half Day', variant: 'amber' },
    ON_LEAVE: { label: 'On Leave', variant: 'blue' },
    PENALTY:  { label: 'Penalty', variant: 'purple' },
    PENDING:  { label: 'Pending', variant: 'amber' },
    APPROVED: { label: 'Approved', variant: 'green' },
    REJECTED: { label: 'Rejected', variant: 'red' },
    DRAFT:    { label: 'Draft', variant: 'gray' },
    FINALIZED:{ label: 'Finalized', variant: 'green' },
    SCHEDULED:{ label: 'Scheduled', variant: 'gray' },
    ACCEPTED: { label: 'Accepted', variant: 'blue' },
    REFUSED:  { label: 'Refused', variant: 'red' },
    DEPARTED: { label: 'Departed', variant: 'amber' },
    ARRIVED:  { label: 'Arrived', variant: 'amber' },
    COMPLETED:{ label: 'Completed', variant: 'green' },
    TRIAL:    { label: 'Trial', variant: 'blue' },
    SUSPENDED:{ label: 'Suspended', variant: 'red' },
    CANCELLED:{ label: 'Cancelled', variant: 'gray' },
    CREDIT:   { label: 'Credit', variant: 'red' },
    PAYMENT:  { label: 'Payment', variant: 'green' },
    MS:       { label: 'MS', variant: 'green' },
    HSD:      { label: 'HSD', variant: 'blue' },
    PLANNED:  { label: 'Planned', variant: 'blue' },
    EMERGENCY:{ label: 'Emergency', variant: 'amber' },
  }
  const cfg = map[status] ?? { label: status, variant: 'gray' as const }
  return <Badge label={cfg.label} variant={cfg.variant} />
}
