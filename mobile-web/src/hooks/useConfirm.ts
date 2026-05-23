// src/hooks/useConfirm.ts
// Usage: const { confirm, ConfirmUI } = useConfirm()
// Then: await confirm({ title: '...', message: '...', variant: 'danger' })
// Returns true if confirmed, false if cancelled
// Render <ConfirmUI /> anywhere in your JSX
import { useState, useCallback } from 'react'
import { ConfirmOptions } from '../components/ConfirmDialog'

export const useConfirm = () => {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      setState({ ...opts, resolve })
    })
  }, [])

  const handleConfirm = () => { state?.resolve(true); setState(null) }
  const handleCancel  = () => { state?.resolve(false); setState(null) }

  // Returns the JSX to embed — null when no dialog is pending
  const dialogProps = state
    ? { ...state, onConfirm: handleConfirm, onCancel: handleCancel }
    : null

  return { confirm, dialogProps }
}
