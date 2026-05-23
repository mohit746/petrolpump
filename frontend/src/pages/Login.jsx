import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import useAuthStore from '../stores/useAuthStore'
import toast from 'react-hot-toast'

const Login = () => {
  const [showPassword, setShowPassword] = useState(false)
  const { login, isLoading } = useAuthStore()
  const { t, i18n } = useTranslation()
  const currentLang = i18n.language?.startsWith('hi') ? 'hi' : 'en'
  
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm()

  const onSubmit = async (data) => {
    const result = await login(data.email, data.password)
    if (result.success) {
      toast.success(t('auth.loginSuccess'))
    } else {
      toast.error(result.error)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-orange-50 py-12 px-4 sm:px-6 lg:px-8">
      {/* Language toggle - top right */}
      <div className="absolute top-4 right-4">
        <button
          onClick={() => i18n.changeLanguage(currentLang === 'en' ? 'hi' : 'en')}
          className="flex items-center space-x-2 px-4 py-2 bg-white rounded-full shadow-sm border border-gray-200 text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          <span>{currentLang === 'en' ? '🇮🇳' : '🇬🇧'}</span>
          <span className="text-gray-700">{currentLang === 'en' ? 'हिंदी' : 'English'}</span>
        </button>
      </div>

      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 bg-primary-600 rounded-2xl flex items-center justify-center shadow-lg">
            <svg className="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">{t('app.tagline')}</h2>
          <p className="mt-2 text-sm text-gray-600">{t('auth.loginTitle')}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('auth.email')}
              </label>
              <input
                {...register('email', {
                  required: t('errors.required'),
                  pattern: {
                    value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                    message: t('errors.invalidEmail'),
                  },
                })}
                type="email"
                className="input"
                placeholder={t('auth.emailPlaceholder')}
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('auth.password')}
              </label>
              <div className="relative">
                <input
                  {...register('password', {
                    required: t('errors.required'),
                    minLength: { value: 6, message: 'Minimum 6 characters' },
                  })}
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder={t('auth.passwordPlaceholder')}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword
                    ? <EyeSlashIcon className="h-5 w-5 text-gray-400" />
                    : <EyeIcon className="h-5 w-5 text-gray-400" />
                  }
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-3 px-4 border border-transparent text-sm font-semibold rounded-xl text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <div className="flex items-center">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  {t('auth.loggingIn')}
                </div>
              ) : t('auth.loginButton')}
            </button>

            <div className="text-center">
              <p className="text-xs text-gray-500 bg-gray-50 p-2 rounded-lg">
                Demo: admin@petrolpump.com / admin123
              </p>
            </div>
          </form>
        </div>

        {/* Role legend */}
        <div className="bg-white rounded-xl shadow-sm p-4 text-xs text-gray-500">
          <p className="font-medium text-gray-700 mb-2">Roles / भूमिकाएं:</p>
          <div className="grid grid-cols-2 gap-1">
            <span>🔴 {t('roles.SUPER_ADMIN')}</span>
            <span>🟠 {t('roles.ADMIN')}</span>
            <span>🟢 {t('roles.ACCOUNTANT')}</span>
            <span>🔵 {t('roles.EMPLOYEE')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login