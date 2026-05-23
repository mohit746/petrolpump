// src/components/ui/Dialog.tsx
import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}

export const Dialog: React.FC<DialogProps> = ({ open, onClose, title, children, size = 'md' }) => {
  const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' }
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
            className={`relative w-full ${widths[size]} bg-white dark:bg-slate-800 rounded-t-2xl md:rounded-2xl
                        shadow-2xl max-h-[90vh] overflow-y-auto`}
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-700">
              <h2 className="font-semibold text-slate-900 dark:text-white text-base">{title}</h2>
              <button onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="p-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger = false, loading = false
}) => (
  <Dialog open={open} onClose={onClose} title={title} size="sm">
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">{message}</p>
    <div className="flex gap-2 justify-end">
      <button onClick={onClose} className="btn-secondary" disabled={loading}>Cancel</button>
      <button
        onClick={onConfirm}
        disabled={loading}
        className={danger ? 'btn-danger' : 'btn-primary'}
      >
        {loading ? 'Please wait…' : confirmLabel}
      </button>
    </div>
  </Dialog>
)
