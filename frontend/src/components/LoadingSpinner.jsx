import React from 'react'

const LoadingSpinner = ({ size = 'medium', text = 'Loading...' }) => {
  const sizeClasses = {
    small: 'w-4 h-4',
    medium: 'w-8 h-8',
    large: 'w-16 h-16'
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <div
        className={`${sizeClasses[size]} border-4 border-gray-200 border-t-primary-600 rounded-full animate-spin`}
      />
      {text && (
        <p className="mt-4 text-gray-600 text-sm">{text}</p>
      )}
    </div>
  )
}

export default LoadingSpinner