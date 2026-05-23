// src/components/ui/SkeletonCard.tsx
import React from 'react'

export const SkeletonCard: React.FC<{ rows?: number }> = ({ rows = 3 }) => (
  <div className="card animate-pulse space-y-3">
    <div className="skeleton h-4 w-1/3 rounded" />
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="skeleton h-3 rounded" style={{ width: `${70 + (i % 3) * 10}%` }} />
    ))}
  </div>
)

export const SkeletonList: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="space-y-3">
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonCard key={i} rows={2} />
    ))}
  </div>
)

export const SkeletonStatGrid: React.FC = () => (
  <div className="grid grid-cols-2 gap-3">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="card animate-pulse space-y-2">
        <div className="skeleton h-6 w-1/2 rounded" />
        <div className="skeleton h-3 w-3/4 rounded" />
      </div>
    ))}
  </div>
)
