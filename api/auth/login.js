import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { supabase } from '../_lib/supabase.js'
import { createResponse, createError } from '../_lib/utils.js'

export default async function handler(request) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200 })
  }

  if (request.method !== 'POST') {
    return createError('Method not allowed', 405)
  }

  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return createError('Email and password are required')
    }

    // First, authenticate with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      return createError('Invalid email or password', 401)
    }

    // Get user details from our users table
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', authData.user.id)
      .single()

    if (userError || !user) {
      return createError('User profile not found', 404)
    }

    if (!user.is_active) {
      return createError('Account is deactivated', 401)
    }

    // Create JWT token
    const token = jwt.sign(
      { 
        userId: user.id,
        email: user.email,
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    return createResponse({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
        },
      },
    })
  } catch (error) {
    console.error('Login error:', error)
    return createError('Login failed', 500)
  }
}