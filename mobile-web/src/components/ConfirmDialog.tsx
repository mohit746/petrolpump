// src/components/ConfirmDialog.tsx
// Global reusable confirmation dialog — use with useConfirm hook
import React from 'react'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'info'
}

interface ConfirmDialogProps extends ConfirmOptions {
  onConfirm: () => void
  onCancel: () => void
}

const variantStyles = {
  danger:  { btn: 'bg-red-600 hover:bg-red-700',   icon: '🚫', border: 'border-red-100' },
  warning: { btn: 'bg-yellow-500 hover:bg-yellow-600', icon: '⚠️', border: 'border-yellow-100' },
  info:    { btn: 'bg-orange-500 hover:bg-orange-600', icon: 'ℹ️', border: 'border-orange-100' },
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title, message, confirmLabel = 'Yes, Confirm', cancelLabel = 'Cancel',
  variant = 'info', onConfirm, onCancel,
}) => {
  const s = variantStyles[variant]
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
      <div className={`bg-white w-full max-w-xs rounded-2xl overflow-hidden border ${s.border}`}>
        {/* Header */}
        <div className="px-5 pt-5 pb-3 text-center">
          <div className="text-4xl mb-3">{s.icon}</div>
          <h3 className="text-base font-bold text-gray-900 mb-1">{title}</h3>
          <p className="text-sm text-gray-500 leading-relaxed">{message}</p>
        </div>
        {/* Buttons */}
        <div className="flex border-t border-gray-100">
          <button
            onClick={onCancel}
            className="flex-1 py-4 text-sm font-medium text-gray-600 border-r border-gray-100 hover:bg-gray-50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-4 text-sm font-bold text-white transition-colors ${s.btn}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
