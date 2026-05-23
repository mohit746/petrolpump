// src/pages/Login.tsx
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import useAuthStore from '../stores/useAuthStore'
import { supabase } from '../lib/supabase'

interface LoginForm { identifier: string; password: string }

// Detect if input looks like a phone number (starts with digit, +, or is 10+ digits)
const isPhoneNumber = (value: string) => /^[+\d][\d\s\-()]{7,}$/.test(value.trim())

const Login: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { login, isLoading } = useAuthStore()
  const navigate = useNavigate()
  const [showPw, setShowPw] = useState(false)
  const [_resolving, setResolving] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>()

  const onSubmit = async (data: LoginForm) => {
    let email = data.identifier.trim()

    // If phone number entered → look up the email from users table via RPC (bypasses RLS)
    if (isPhoneNumber(email)) {
      setResolving(true)

      const { data: foundEmail, error } = await supabase
        .rpc('get_email_by_phone', { input_phone: email.trim() })

      setResolving(false)

      if (error) {
        // RPC doesn't exist yet — remind to run SQL
        console.error('get_email_by_phone RPC error:', error.message)
        toast.error('Phone login setup incomplete. Please run the SQL function in Supabase. (See console)', { duration: 6000 })
        return
      }

      if (!foundEmail) {
        toast.error('No active account found with this mobile number')
        return
      }

      email = foundEmail as string
    }

    const result = await login(email, data.password)
    if (result.success) {
      toast.success(t('auth.success'))
      navigate('/', { replace: true })
    } else {
      // Give specific guidance for common errors
      const msg = result.error || ''
      if (msg.toLowerCase().includes('email not confirmed')) {
        toast.error('Account not confirmed. Ask your platform admin to confirm the account in Supabase dashboard, or disable email confirmations.', { duration: 6000 })
      } else if (msg.toLowerCase().includes('invalid login') || msg.toLowerCase().includes('invalid credentials')) {
        toast.error('Wrong password. Please try again.')
      } else {
        toast.error(msg || t('errors.server'))
      }
    }
  }

  const isHindi = i18n.language?.startsWith('hi')

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-500 to-orange-700 flex flex-col">
      {/* Language toggle */}
      <div className="flex justify-end p-4">
        <button
          onClick={() => i18n.changeLanguage(isHindi ? 'en' : 'hi')}
          className="px-4 py-2 bg-white/20 text-white rounded-full text-sm font-medium backdrop-blur-sm"
        >
          {t('lang.switch')}
        </button>
      </div>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-4">
        <div className="mb-8 text-center">
          <div className="h-20 w-20 bg-white rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-xl">
            <span className="text-4xl">⛽</span>
          </div>
          <h1 className="text-3xl font-bold text-white">{t('app.name')}</h1>
          <p className="text-orange-100 text-sm mt-1">{t('app.tagline')}</p>
        </div>

        {/* Login card */}
        <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 space-y-4">
          <h2 className="text-lg font-bold text-gray-900 text-center">{t('auth.title')}</h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="label">Mobile Number or Email</label>
              <input
                type="text"
                className="input"
                placeholder="9876543210 or you@example.com"
                {...register('identifier', { required: t('errors.required') })}
              />
              {errors.identifier && <p className="text-xs text-red-500 mt-1">{errors.identifier.message}</p>}
            </div>

            <div>
              <label className="label">{t('auth.password')}</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input pr-12"
                  placeholder="••••••••"
                  {...register('password', { required: t('errors.required') })}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                >
                  {showPw
                    ? <EyeSlashIcon className="h-5 w-5" />
                    : <EyeIcon className="h-5 w-5" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full"
            >
              {isLoading
                ? <><span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />{t('auth.loggingIn')}</>
                : t('auth.loginBtn')}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 pt-2">
            Need help?{' '}
            <a href="tel:+919640620555" className="text-orange-500 font-medium">+91-96406 20555</a>
          </p>
        </div>
      </div>
    </div>
  )
}

export default Login
