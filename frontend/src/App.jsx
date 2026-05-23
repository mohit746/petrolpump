import React, { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import useAuthStore from './stores/useAuthStore'

// Components
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Shifts from './pages/Shifts'
import Dispensers from './pages/Dispensers'
import Readings from './pages/Readings'
import Employees from './pages/Employees'
import Attendance from './pages/Attendance'
import Leaves from './pages/Leaves'
import Incentives from './pages/Incentives'
import FuelLoads from './pages/FuelLoads'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import LoadingSpinner from './components/LoadingSpinner'

function App() {
  const { isAuthenticated, isLoading, verifyAuth } = useAuthStore()

  useEffect(() => {
    verifyAuth()
  }, [verifyAuth])

  if (isLoading) return <LoadingSpinner />

  return (
    <Router>
      <div className="App">
        <Routes>
          <Route
            path="/login"
            element={isAuthenticated ? <Navigate to="/dashboard" /> : <Login />}
          />

          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Layout>
                  <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/shifts" element={
                      <ProtectedRoute requiredPermission="shifts"><Shifts /></ProtectedRoute>
                    } />
                    <Route path="/dispensers" element={
                      <ProtectedRoute requiredPermission="dispensers"><Dispensers /></ProtectedRoute>
                    } />
                    <Route path="/readings" element={
                      <ProtectedRoute requiredPermission="readings"><Readings /></ProtectedRoute>
                    } />
                    <Route path="/employees" element={
                      <ProtectedRoute requiredPermission="employees"><Employees /></ProtectedRoute>
                    } />
                    <Route path="/attendance" element={
                      <ProtectedRoute requiredPermission="attendance"><Attendance /></ProtectedRoute>
                    } />
                    <Route path="/leaves" element={
                      <ProtectedRoute requiredPermission="leaves"><Leaves /></ProtectedRoute>
                    } />
                    <Route path="/incentives" element={
                      <ProtectedRoute requiredPermission="incentives"><Incentives /></ProtectedRoute>
                    } />
                    <Route path="/fuel-loads" element={
                      <ProtectedRoute requiredPermission="fuelLoads"><FuelLoads /></ProtectedRoute>
                    } />
                  </Routes>
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="*"
            element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} />}
          />
        </Routes>
      </div>
    </Router>
  )
}

export default App