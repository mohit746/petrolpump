import React from 'react'
import useAuthStore from '../stores/useAuthStore'
import { Navigate } from 'react-router-dom'
import { useRoleAccess } from '../hooks/useRoleAccess'

const ProtectedRoute = ({ children, requiredPermission }) => {
  const { isAuthenticated } = useAuthStore()
  const { can } = useRoleAccess()

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

  if (requiredPermission && !can(requiredPermission)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Access Denied</h2>
          <p className="text-gray-500">You don't have permission to view this page.</p>
        </div>
      </div>
    )
  }

  return children
}

export default ProtectedRoute