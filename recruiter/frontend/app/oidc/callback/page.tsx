'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'

const getCookie = (name: string) => {
  if (typeof document === 'undefined') {
    return ''
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ''
}

export default function OidcCallbackPage() {
  const auth = useAuth()
  const router = useRouter()

  useEffect(() => {
    const hash = window.location.hash
    const search = window.location.search
    const hashParams = new URLSearchParams(hash.replace('#', ''))
    const searchParams = new URLSearchParams(search)

    const token = hashParams.get('token') || searchParams.get('token') || getCookie('dev_jwt') || ''
    const refreshToken =
      hashParams.get('refreshToken') ||
      searchParams.get('refreshToken') ||
      getCookie('dev_refreshToken') ||
      ''
    const expiresIn =
      hashParams.get('expiresIn') ||
      searchParams.get('expiresIn') ||
      getCookie('dev_expiresIn') ||
      '10m'

    if (token && refreshToken) {
      auth.login(token, refreshToken, expiresIn)
      const url = new URL(window.location.href)
      url.hash = ''
      url.searchParams.delete('token')
      url.searchParams.delete('refreshToken')
      url.searchParams.delete('expiresIn')
      window.history.replaceState({}, '', url.pathname)
      document.cookie = 'dev_jwt=; Max-Age=0; path=/'
      document.cookie = 'dev_refreshToken=; Max-Age=0; path=/'
      document.cookie = 'dev_expiresIn=; Max-Age=0; path=/'
      return
    }

    router.replace('/login')
  }, [auth, router])

  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
      Signing you in...
    </div>
  )
}
