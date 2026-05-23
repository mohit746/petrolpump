// src/App.tsx
import React, { lazy, Suspense, useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import useAuthStore from './stores/useAuthStore'
import { Sidebar } from './components/layout/Sidebar'
import { BottomNav } from './components/layout/BottomNav'
import { Header } from './components/layout/Header'
import { ToastProvider } from './components/ui/Toast'
import { PageSpinner } from './components/ui/Spinner'
import { RequirePerm } from './components/guards/RequirePerm'
import { RequirePump } from './components/guards/RequirePump'

// ── Lazy pages ───────────────────────────────────────────────
const Login             = lazy(() => import('./pages/Login'))
const Dashboard         = lazy(() => import('./pages/Dashboard'))
const Attendance        = lazy(() => import('./pages/Attendance'))
const Leaves            = lazy(() => import('./pages/Leaves'))
const Readings          = lazy(() => import('./pages/Readings'))
const CreditManagement  = lazy(() => import('./pages/CreditManagement'))
const LorryDuty         = lazy(() => import('./pages/LorryDuty'))
const Incentives        = lazy(() => import('./pages/Incentives'))
const Employees         = lazy(() => import('./pages/Employees'))
const Payslip           = lazy(() => import('./pages/Payslip'))
const Settings          = lazy(() => import('./pages/Settings'))
const PlatformDashboard = lazy(() => import('./pages/PlatformDashboard'))
const PumpDetail        = lazy(() => import('./pages/PumpDetail'))
const FuelManagement    = lazy(() => import('./pages/FuelManagement'))
const Machines          = lazy(() => import('./pages/Machines'))
const SalaryAdvances    = lazy(() => import('./pages/SalaryAdvances'))
const Reports           = lazy(() => import('./pages/Reports'))

// Page title map
const TITLES: Record<string, string> = {
  '/': 'Dashboard', '/attendance': 'Attendance', '/leaves': 'Leaves',
  '/readings': 'Meter Readings', '/credit': 'Credit Management', '/lorry-duty': 'Lorry Duty',
  '/incentives': 'Incentives', '/employees': 'Employees', '/payslip': 'Payslip',
  '/settings': 'Settings', '/platform': 'Platform Management',
  '/fuel': 'Fuel & Pricing', '/machines': 'Machines & Nozzles', '/advances': 'Salary Advances',
  '/reports': 'Reports',
}

// ── Page transition wrapper ───────────────────────────────────
const PageWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname } = useLocation()
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="flex-1 overflow-y-auto pb-20 md:pb-0"
    >
      {children}
    </motion.div>
  )
}

// ── Staff layout (sidebar + header + bottom nav) ─────────────
const StaffLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false)
  const { pathname } = useLocation()
  const title = TITLES[pathname] ?? 'FuelDesk'

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-900">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header title={title} />
        <AnimatePresence mode="wait">
          <PageWrapper>
            <Suspense fallback={<PageSpinner />}>{children}</Suspense>
          </PageWrapper>
        </AnimatePresence>
        <BottomNav />
      </div>
    </div>
  )
}

// ── Auth guards ───────────────────────────────────────────────
const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

// Tenant routes use RequirePerm + RequirePump together; platform routes use
// only RequirePerm. (RequireRole is gone — see components/guards/RequirePerm.tsx
// and RequirePump.tsx for the replacements.)

const LoginRoute: React.FC = () => {
  const { isAuthenticated, user } = useAuthStore()
  if (isAuthenticated) return <Navigate to={user?.role === 'PLATFORM_OWNER' ? '/platform' : '/'} replace />
  return <Suspense fallback={<PageSpinner />}><Login /></Suspense>
}

// PLATFORM_OWNER hitting "/" should land on the platform dashboard, not on
// the tenant Dashboard (which would query with pump_id = null and crash).
const RootRedirect: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const user = useAuthStore(s => s.user)
  if (user?.role === 'PLATFORM_OWNER') return <Navigate to="/platform" replace />
  return <>{children}</>
}

// ── Init dark mode from system preference ────────────────────
const DarkModeInit: React.FC = () => {
  useEffect(() => {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark')
    }
  }, [])
  return null
}

// ── App ───────────────────────────────────────────────────────
const App: React.FC = () => (
  <BrowserRouter>
    <ToastProvider>
      <DarkModeInit />
      <Routes>
        <Route path="/login" element={<LoginRoute />} />

        {/* ── Tenant routes ──
           Wrapped in RequireAuth → RootRedirect (only the "/" route) →
           RequirePump (denies platform owner + users with no pump_id) →
           RequirePerm (matrix-driven gate). */}
        <Route path="/" element={
          <RequireAuth>
            <RootRedirect>
              <RequirePump>
                <StaffLayout>
                  <Suspense fallback={<PageSpinner />}><Dashboard /></Suspense>
                </StaffLayout>
              </RequirePump>
            </RootRedirect>
          </RequireAuth>
        } />
        <Route path="/attendance" element={
          <RequireAuth>
            <RequirePump>
              <StaffLayout>
                <Suspense fallback={<PageSpinner />}><Attendance /></Suspense>
              </StaffLayout>
            </RequirePump>
          </RequireAuth>
        } />
        <Route path="/leaves" element={
          <RequireAuth>
            <RequirePump>
              <RequirePerm perm={['leaves.list_own', 'leaves.list_all', 'leaves.apply']} mode="any">
                <StaffLayout>
                  <Suspense fallback={<PageSpinner />}><Leaves /></Suspense>
                </StaffLayout>
              </RequirePerm>
            </RequirePump>
          </RequireAuth>
        } />
        <Route path="/readings" element={
          <RequireAuth>
            <RequirePump>
              <RequirePerm perm={['readings.list_own', 'readings.list_all', 'readings.create']} mode="any">
                <StaffLayout>
                  <Suspense fallback={<PageSpinner />}><Readings /></Suspense>
                </StaffLayout>
              </RequirePerm>
            </RequirePump>
          </RequireAuth>
        } />
        <Route path="/credit" element={
          <RequireAuth>
            <RequirePump>
              <RequirePerm perm={['credit.list', 'credit.txn_create']} mode="any">
                <StaffLayout>
                  <Suspense fallback={<PageSpinner />}><CreditManagement /></Suspense>
                </StaffLayout>
              </RequirePerm>
            </RequirePump>
          </RequireAuth>
        } />
        <Route path="/lorry-duty" element={
          <RequireAuth>
            <RequirePump>
              <StaffLayout>
                <Suspense fallback={<PageSpinner />}><LorryDuty /></Suspense>
              </StaffLayout>
            </RequirePump>
          </RequireAuth>
        } />
        <Route path="/incentives" element={
          <RequireAuth>
            <RequirePump>
              <RequirePerm perm="salary.incentive.grant">
                <StaffLayout>
                  <Suspense fallback={<PageSpinner />}><Incentives /></Suspense>
                </StaffLayout>
              </RequirePerm>
            </RequirePump>
          </RequireAuth>
        } />
        <Route path="/employees" element={
          <RequireAuth>
            <RequirePump>
              <RequirePerm perm="users.list">
                <StaffLayout>
                  <Suspense fallback={<PageSpinner />}><Employees /></Suspense>
                </StaffLayout>
              </RequirePerm>
            </RequirePump>
          </RequireAuth>
        } />
        <Route path="/payslip" element={
          <RequireAuth>
            <RequirePump>
              <RequirePerm perm={['salary.payslip.read_own', 'salary.payslip.read_all']} mode="any">
                <StaffLayout>
                  <Suspense fallback={<PageSpinner />}><Payslip /></Suspense>
                </StaffLayout>
              </RequirePerm>
            </RequirePump>
          </RequireAuth>
        } />
        <Route path="/settings" element={
          <RequireAuth>
            <RequirePump>
              <RequirePerm perm="settings.update">
                <StaffLayout>
                  <Suspense fallback={<PageSpinner />}><Settings /></Suspense>
                </StaffLayout>
              </RequirePerm>
            </RequirePump>
          </RequireAuth>
        } />
        <Route path="/fuel" element={
          <RequireAuth>
            <RequirePump>
              <RequirePerm perm={['fuel_type.crud', 'fuel_price.update', 'fuel_price.history.read', 'fuel_purchase.list']} mode="any">
                <StaffLayout>
                  <Suspense fallback={<PageSpinner />}><FuelManagement /></Suspense>
                </StaffLayout>
              </RequirePerm>
            </RequirePump>
          </RequireAuth>
        } />
        <Route path="/machines" element={
          <RequireAuth>
            <RequirePump>
              <RequirePerm perm={['machines.crud', 'nozzles.crud']} mode="any">
                <StaffLayout>
                  <Suspense fallback={<PageSpinner />}><Machines /></Suspense>
                </StaffLayout>
              </RequirePerm>
            </RequirePump>
          </RequireAuth>
        } />
        <Route path="/advances" element={
          <RequireAuth>
            <RequirePump>
              <RequirePerm perm="salary.advance.grant">
                <StaffLayout>
                  <Suspense fallback={<PageSpinner />}><SalaryAdvances /></Suspense>
                </StaffLayout>
              </RequirePerm>
            </RequirePump>
          </RequireAuth>
        } />
        <Route path="/reports" element={
          <RequireAuth>
            <RequirePump>
              <RequirePerm perm="analytics.tenant_dashboard">
                <StaffLayout>
                  <Suspense fallback={<PageSpinner />}><Reports /></Suspense>
                </StaffLayout>
              </RequirePerm>
            </RequirePump>
          </RequireAuth>
        } />

        {/* ── Platform owner routes ──
           No RequirePump — platform owner has no pump_id. */}
        <Route path="/platform" element={
          <RequireAuth>
            <RequirePerm perm="pump.list_all">
              <StaffLayout>
                <Suspense fallback={<PageSpinner />}><PlatformDashboard /></Suspense>
              </StaffLayout>
            </RequirePerm>
          </RequireAuth>
        } />
        <Route path="/platform/pump/:id" element={
          <RequireAuth>
            <RequirePerm perm="pump.list_all">
              <StaffLayout>
                <Suspense fallback={<PageSpinner />}><PumpDetail /></Suspense>
              </StaffLayout>
            </RequirePerm>
          </RequireAuth>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  </BrowserRouter>
)

export default App
