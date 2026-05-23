// src/components/ui/Spinner.tsx
import React from 'react'
import { cn } from '../../lib/utils'

export const Spinner: React.FC<{ size?: 'sm' | 'md' | 'lg'; className?: string }> = ({
  size = 'md', className
}) => {
  const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' }
  return (
    <div
      className={cn(
        'border-2 border-emerald-200 border-t-emerald-500 rounded-full animate-spin',
        sizes[size], className
      )}
    />
  )
}

export const PageSpinner: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
    <div className="flex flex-col items-center gap-3">
      <Spinner size="lg" />
      <p className="text-sm text-slate-500">Loading…</p>
    </div>
  </div>
)
