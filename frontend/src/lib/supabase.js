// src/lib/supabase.js
// Single Supabase client — replaces the entire custom API layer
// Uses Row Level Security (RLS) so each user only sees their own data
// 100% free — Supabase free tier: 500MB DB, 50K auth users, 1GB storage

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase env vars. Copy .env.example to .env.local')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

export default supabase
