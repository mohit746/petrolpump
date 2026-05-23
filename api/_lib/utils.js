import jwt from 'jsonwebtoken'
import { supabase } from './supabase.js'

export function createResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

export function createError(message, status = 400) {
  return createResponse({ success: false, error: message }, status)
}

export function successResponse(data, status = 200) {
  return createResponse({ success: true, data }, status)
}

export function errorResponse(message, status = 400) {
  return createError(message, status)
}

export async function verifyAuth(request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('No authorization header')
    }

    const token = authHeader.substring(7)
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single()

    if (error || !user) throw new Error('User not found')
    if (!user.is_active) throw new Error('User account is deactivated')

    return user
  } catch (error) {
    throw new Error('Invalid or expired token')
  }
}

export function requireRole(allowedRoles) {
  return (user) => {
    if (!allowedRoles.includes(user.role)) {
      throw new Error('Insufficient permissions')
    }
    return true
  }
}

export async function verifyAuth(request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('No authorization header')
    }

    const token = authHeader.substring(7)
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Get user from Supabase
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single()

    if (error || !user) {
      throw new Error('User not found')
    }

    if (!user.is_active) {
      throw new Error('User account is deactivated')
    }

    return user
  } catch (error) {
    throw new Error('Invalid or expired token')
  }
}

export function requireRole(allowedRoles) {
  return (user) => {
    if (!allowedRoles.includes(user.role)) {
      throw new Error('Insufficient permissions')
    }
    return true
  }
}