// src/lib/utils.ts
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function formatINR(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

export function getInitials(first: string, last?: string): string {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase()
}

/**
 * Normalize phone numbers for consistent storage and lookup.
 * Strips spaces/dashes/parens/plus, returns the last 10 digits if present.
 * Returns empty string if input has no digits.
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 0) return ''
  // If 10+ digits, return the last 10 (drops country code 91 / leading 0)
  if (digits.length >= 10) return digits.slice(-10)
  return digits
}

/**
 * Detect whether a string looks like a phone number rather than an email.
 * Pure heuristic: contains an "@" → email; otherwise digits + optional formatting → phone.
 */
export function isPhoneInput(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.includes('@')) return false
  return /^[+\d][\d\s\-()]{6,}$/.test(trimmed)
}

/** Haversine distance in metres */
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}
