// src/lib/supabase.ts
// Direct Supabase client — NO custom backend needed
// RLS policies enforce data security on the DB level

import { createClient } from '@supabase/supabase-js'

const url  = import.meta.env.VITE_SUPABASE_URL  as string
const key  = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
})

export default supabase
