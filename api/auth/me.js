import { verifyAuth, createResponse, createError } from '../_lib/utils.js'

export default async function handler(request) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200 })
  }

  if (request.method !== 'GET') {
    return createError('Method not allowed', 405)
  }

  try {
    const user = await verifyAuth(request)

    return createResponse({
      success: true,
      data: {
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
    console.error('Auth verification error:', error)
    return createError(error.message, 401)
  }
}