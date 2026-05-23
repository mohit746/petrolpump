// src/App.tsx
import React, { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import useAuthStore from './stores/useAuthStore'
import { useRoleAccess } from './hooks/useRoleAccess'
import BottomNav from './components/BottomNav'

// ── Pages ─────────────────────────────────────────────────────
const Login              = lazy(() => import('./pages/Login'))
const Dashboard          = lazy(() => import('./pages/Dashboard'))
const Attendance         = lazy(() => import('./pages/Attendance'))
const Leaves             = lazy(() => import('./pages/Leaves'))
const LorryDuty          = lazy(() => import('./pages/LorryDuty'))
const Payslip            = lazy(() => import('./pages/Payslip'))
const Employees          = lazy(() => import('./pages/Employees'))
const Incentives         = lazy(() => import('./pages/Incentives'))
const Settings           = lazy(() => import('./pages/Settings'))
const Readings           = lazy(() => import('./pages/Readings'))
const CreditManagement   = lazy(() => import('./pages/CreditManagement'))
// Platform Owner pages
const PlatformDashboard  = lazy(() => import('./pages/PlatformDashboard'))
const PumpDetail         = lazy(() => import('./pages/PumpDetail'))

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-orange-50">
    <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
  </div>
)

// ── Pump staff layout (with bottom nav) ───────────────────────
const StaffLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex flex-col h-full">
    <div className="flex-1 overflow-y-auto pb-20">
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </div>
    <BottomNav />
  </div>
)

// ── Role-based guard ──────────────────────────────────────────
const RoleGuard: React.FC<{
  allow: string[]
  children: React.ReactNode
}> = ({ allow, children }) => {
  const { user } = useAuthStore()
  if (!user) return <Navigate to="/login" replace />
  if (!allow.includes(user.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

// ── Login guard — redirect away if already authenticated ─────
const LoginRoute: React.FC = () => {
  const { isAuthenticated, user } = useAuthStore()
  if (isAuthenticated) {
    if (user?.role === 'PLATFORM_OWNER') return <Navigate to="/platform" replace />
    return <Navigate to="/" replace />
  }
  return (
    <Suspense fallback={<PageLoader />}><Login /></Suspense>
  )
}

// ── Root redirect based on role ───────────────────────────────
const RootRedirect: React.FC = () => {
  const { user, isAuthenticated } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (user?.role === 'PLATFORM_OWNER') return <Navigate to="/platform" replace />
  return (
    <StaffLayout>
      <Suspense fallback={<PageLoader />}><Dashboard /></Suspense>
    </StaffLayout>
  )
}

// ── Protected wrapper for staff pages ─────────────────────────
const Protected: React.FC<{
  page: React.ReactNode
  permission?: string
}> = ({ page, permission }) => {
  const { isAuthenticated, user } = useAuthStore()
  const { can } = useRoleAccess()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (user?.role === 'PLATFORM_OWNER') return <Navigate to="/platform" replace />
  if (permission && !can(permission)) return <Navigate to="/" replace />
  return (
    <StaffLayout>
      <Suspense fallback={<PageLoader />}>{page}</Suspense>
    </StaffLayout>
  )
}

// ── Main App ──────────────────────────────────────────────────
const App: React.FC = () => {
  const { initialize, isLoading } = useAuthStore()
  useEffect(() => { initialize() }, [initialize])

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-orange-50">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-orange-600 font-medium text-sm">Loading...</p>
      </div>
    </div>
  )

  return (
    <Router>
      <Routes>
        {/* Public — redirects away if already logged in */}
        <Route path="/login" element={<LoginRoute />} />

        {/* Root — smart redirect */}
        <Route path="/" element={<RootRedirect />} />

        {/* ── Platform Owner (no bottom nav) ── */}
        <Route path="/platform" element={
          <RoleGuard allow={['PLATFORM_OWNER']}>
            <Suspense fallback={<PageLoader />}><PlatformDashboard /></Suspense>
          </RoleGuard>
        } />
        <Route path="/pumps/:id" element={
          <RoleGuard allow={['PLATFORM_OWNER']}>
            <Suspense fallback={<PageLoader />}><PumpDetail /></Suspense>
          </RoleGuard>
        } />

        {/* ── Pump staff pages ── */}
        <Route path="/dashboard"  element={<Protected page={<Dashboard />} />} />
        <Route path="/attendance" element={<Protected page={<Attendance />} permission="attendance" />} />
        <Route path="/leaves"     element={<Protected page={<Leaves />} permission="leaves" />} />
        <Route path="/lorry"      element={<Protected page={<LorryDuty />} permission="lorry_duty" />} />
        <Route path="/payslip"    element={<Protected page={<Payslip />} permission="payslip" />} />
        <Route path="/employees"  element={<Protected page={<Employees />} permission="employees" />} />
        <Route path="/incentives" element={<Protected page={<Incentives />} permission="incentives" />} />
        <Route path="/readings"   element={<Protected page={<Readings />} permission="readings" />} />
        <Route path="/credits"    element={<Protected page={<CreditManagement />} permission="credit_management" />} />
        <Route path="/settings"   element={<Protected page={<Settings />} permission="settings" />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  )
}

export default App
