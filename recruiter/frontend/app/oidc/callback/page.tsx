'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { tokenManager } from '@/utils/tokenManager'
import { markCentralSessionEstablished } from '@/utils/centralSession'
import {
  IdentityHandoff,
  identityHandoffStyles as styles,
} from '@/components/auth/IdentityHandoff'

const getCookie = (name: string) => {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ''
}

export default function OidcCallbackPage() {
  const router = useRouter()
  const [status, setStatus] = useState('Verifying your Seemplify identity…')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const processTokens = () => {
      try {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
        const searchParams = new URLSearchParams(window.location.search)
        const callbackToken = hashParams.get('token') || searchParams.get('token') || ''
        const token = callbackToken || getCookie('dev_jwt') || ''
        const refreshToken = hashParams.get('refreshToken') || searchParams.get('refreshToken') || getCookie('dev_refreshToken') || ''
        const expiresIn = hashParams.get('expiresIn') || searchParams.get('expiresIn') || getCookie('dev_expiresIn') || '10m'

        if (token) {
          if (callbackToken) markCentralSessionEstablished()
          if (refreshToken) tokenManager.initialize(token, refreshToken, expiresIn)
          else tokenManager.setAccessToken(token, expiresIn)

          const url = new URL(window.location.href)
          url.hash = ''
          url.searchParams.delete('token')
          url.searchParams.delete('refreshToken')
          url.searchParams.delete('expiresIn')
          window.history.replaceState({}, '', url.pathname)
          document.cookie = 'dev_jwt=; Max-Age=0; path=/'
          document.cookie = 'dev_refreshToken=; Max-Age=0; path=/'
          document.cookie = 'dev_expiresIn=; Max-Age=0; path=/'
          setStatus('Opening your Recruiter workspace…')
          window.location.assign('/organization/check')
          return
        }

        if (tokenManager.getAccessToken()) {
          setStatus('Opening your Recruiter workspace…')
          window.location.assign('/organization/check')
          return
        }

        setFailed(true)
        setStatus('The identity response did not include a usable session. Please start again.')
      } catch (error) {
        console.error('OIDC callback failed:', error)
        setFailed(true)
        setStatus('Recruiter could not finish this sign-in. Please start again.')
      }
    }

    processTokens()
  }, [router])

  return (
    <IdentityHandoff
      eyebrow="Seemplify identity"
      title="One secure handoff. No second login."
      description="Your verified identity is being exchanged for an organization-scoped Recruiter session."
      cardIcon={<ShieldCheck />}
      cardTitle={failed ? 'Sign-in needs attention' : 'Completing sign-in'}
      cardDescription="Keep this page open while Recruiter prepares your workspace."
    >
      <div className={styles.status} data-tone={failed ? 'error' : 'neutral'} role={failed ? 'alert' : 'status'}>
        {!failed ? <span className={styles.spinner} aria-hidden="true" /> : null}
        <span>{status}</span>
      </div>
      {failed ? (
        <button className={styles.primary} type="button" onClick={() => router.replace('/login')}>Try again</button>
      ) : null}
    </IdentityHandoff>
  )
}
