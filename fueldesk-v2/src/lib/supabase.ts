// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase env vars. Check .env.local')
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
