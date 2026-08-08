'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { tokenManager } from '@/utils/tokenManager'
import { markCentralSessionEstablished } from '@/utils/centralSession'

const getCookie = (name: string) => {
  if (typeof document === 'undefined') {
    return ''
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ''
}

export default function OidcCallbackPage() {
  const router = useRouter()
  const [status, setStatus] = useState('Signing you in...')

  useEffect(() => {
    const processTokens = () => {
      try {
        const hash = window.location.hash
        const search = window.location.search

        console.log('OIDC Callback processing:', {
          hasHash: !!hash,
          hasSearch: !!search,
          hasCookies: !!getCookie('dev_jwt')
        })

        const hashParams = new URLSearchParams(hash.replace('#', ''))
        const searchParams = new URLSearchParams(search)

        const callbackToken = hashParams.get('token') || searchParams.get('token') || ''
        const token = callbackToken || getCookie('dev_jwt') || ''
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

        if (token) {
          console.log('Tokens found, initializing session...')

          if (callbackToken) {
            markCentralSessionEstablished()
          }

          if (refreshToken) {
            tokenManager.initialize(token, refreshToken, expiresIn)
          } else {
            tokenManager.setAccessToken(token, expiresIn)
          }

          // Clean up URL and cookies
          const url = new URL(window.location.href)
          url.hash = ''
          url.searchParams.delete('token')
          url.searchParams.delete('refreshToken')
          url.searchParams.delete('expiresIn')
          window.history.replaceState({}, '', url.pathname)

          // Clear dev cookies
          document.cookie = 'dev_jwt=; Max-Age=0; path=/'
          document.cookie = 'dev_refreshToken=; Max-Age=0; path=/'
          document.cookie = 'dev_expiresIn=; Max-Age=0; path=/'

          setStatus('Redirecting...')
          window.location.href = '/organization/check'
          return
        }

        // AuthContext may have consumed tokens first and already initialized storage.
        const existingToken = tokenManager.getAccessToken()
        if (existingToken) {
          console.log('Existing session detected, redirecting...')
          setStatus('Redirecting...')
          window.location.href = '/organization/check'
          return
        }

        console.log('No tokens found, redirecting to login...')
        setStatus('No tokens found, redirecting to login...')
        router.replace('/login')
      } catch (error) {
        console.error('OIDC Callback error:', error)
        setStatus('Error processing login, redirecting...')
        router.replace('/login')
      }
    }

    processTokens()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-sm text-muted-foreground">{status}</p>
      </div>
    </div>
  )
}
