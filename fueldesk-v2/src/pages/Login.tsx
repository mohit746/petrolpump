// src/pages/Login.tsx
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Fuel, Loader2, Mail, Phone } from 'lucide-react'
import { motion } from 'framer-motion'
import useAuthStore from '../stores/useAuthStore'
import { useToast } from '../components/ui/Toast'

const isPhoneInput = (v: string) => /^[+\d][\d\s\-()]{6,}$/.test(v.trim())

const schema = z.object({
  identifier: z.string().min(1, 'Enter your email or mobile number').refine(
    v => {
      const trimmed = v.trim()
      if (isPhoneInput(trimmed)) return trimmed.replace(/\D/g, '').length >= 7
      return z.string().email().safeParse(trimmed).success
    },
    { message: 'Enter a valid email or mobile number' }
  ),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})
type FormData = z.infer<typeof schema>

const Login: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { login, isLoading } = useAuthStore()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [showPw, setShowPw] = useState(false)
  const [identifierValue, setIdentifierValue] = useState('')

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    const result = await login(data.identifier, data.password)
    if (result.success) {
      toast(t('auth.success'), 'success')
      navigate('/', { replace: true })
    } else {
      toast(result.error ?? t('common.error'), 'error')
    }
  }

  const isPhone = isPhoneInput(identifierValue)
  const isHindi = i18n.language?.startsWith('hi')

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900">
      {/* Top bar */}
      <div className="flex justify-end p-4">
        <button
          onClick={() => i18n.changeLanguage(isHindi ? 'en' : 'hi')}
          className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-800
                     text-slate-600 dark:text-slate-300 rounded-full shadow-sm border
                     border-slate-200 dark:border-slate-700 hover:bg-emerald-50 transition-colors"
        >
          {isHindi ? 'English' : 'हिंदी'}
        </button>
      </div>

      {/* Center */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-sm"
        >
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/40">
              <Fuel className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('app.name')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('app.tagline')}</p>
          </div>

          {/* Card */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg shadow-slate-200/60
                          dark:shadow-slate-900/60 border border-slate-100 dark:border-slate-700 p-6">
            <h2 className="text-base font-semibold text-slate-800 dark:text-white mb-5">
              {t('auth.title')}
            </h2>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="label">
                  {isPhone ? t('common.phone') : t('auth.emailOrMobile')}
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    {isPhone ? <Phone className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
                  </div>
                  <input
                    type="text"
                    inputMode={isPhone ? 'tel' : 'email'}
                    placeholder="email@example.com or +91 9876543210"
                    className="input pl-9"
                    {...register('identifier', {
                      onChange: e => setIdentifierValue(e.target.value),
                    })}
                  />
                </div>
                {errors.identifier && <p className="text-xs text-rose-500 mt-1">{errors.identifier.message}</p>}
              </div>

              <div>
                <label className="label">{t('auth.password')}</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="input pr-10"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-rose-500 mt-1">{errors.password.message}</p>}
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary w-full py-3 mt-2 text-base"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('auth.login')}
              </button>
            </form>
          </div>

          {/* Support footer */}
          <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-6">
            Need help? +91-96406 20555 · mohitdwivedi746@gmail.com
          </p>
        </motion.div>
      </div>
    </div>
  )
}

export default Login
