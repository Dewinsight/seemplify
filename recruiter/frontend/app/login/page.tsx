'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { getApiBaseUrl, getIdpBaseUrl } from '@/utils/env'
import { markCentralSessionEstablished } from '@/utils/centralSession'
import {
  IdentityHandoff,
  IdentityTextLink,
  identityHandoffStyles as styles,
} from '@/components/auth/IdentityHandoff'

type LoginPhase = 'starting' | 'processing' | 'error'

export default function LoginPage() {
  const auth = useAuth()
  const [phase, setPhase] = useState<LoginPhase>('starting')
  const [message, setMessage] = useState('Opening Seemplify secure sign-in…')

  const startOidcLogin = useCallback(() => {
    setPhase('starting')
    setMessage('Opening Seemplify secure sign-in…')
    const returnTo = `${window.location.origin}/login`
    window.location.assign(`${getApiBaseUrl()}/api/auth/oidc/start?returnTo=${encodeURIComponent(returnTo)}`)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const reportedError = params.get('error')
    if (reportedError) {
      setPhase('error')
      setMessage('Seemplify could not complete this sign-in. Your session is safe; try again when you are ready.')
      return
    }

    const hash = window.location.hash
    if (!hash.includes('token=')) return

    setPhase('processing')
    setMessage('Finishing your Recruiter session…')
    const callback = new URLSearchParams(hash.replace(/^#/, ''))
    const token = callback.get('token') || ''
    const refreshToken = callback.get('refreshToken') || ''
    const expiresIn = callback.get('expiresIn') || '10m'

    if (!token || !refreshToken) {
      setPhase('error')
      setMessage('The identity response was incomplete. Please start sign-in again.')
      return
    }

    try {
      markCentralSessionEstablished()
      auth.login(token, refreshToken, expiresIn)
      window.history.replaceState({}, '', '/login')
    } catch (error) {
      console.error('OIDC login completion failed:', error)
      setPhase('error')
      setMessage('Recruiter could not finish creating your session. Please try again.')
    }
  }, [auth])

  useEffect(() => {
    if (auth.isLoading || auth.isAuthenticated || phase === 'processing' || phase === 'error') return
    const timer = window.setTimeout(startOidcLogin, 250)
    return () => window.clearTimeout(timer)
  }, [auth.isAuthenticated, auth.isLoading, phase, startOidcLogin])

  useEffect(() => {
    if (phase === 'error') return
    const timer = window.setTimeout(() => {
      setPhase('error')
      setMessage('Secure sign-in is taking longer than expected. You can retry without losing any work.')
    }, 15_000)
    return () => window.clearTimeout(timer)
  }, [phase])

  return (
    <IdentityHandoff
      eyebrow="Seemplify identity"
      title="One account for every Seemplify workspace."
      description="Sign in once, then move between Recruiter and the App Hub without managing another password or separate session."
      cardIcon={<ShieldCheck />}
      cardTitle={phase === 'error' ? 'Sign-in needs attention' : 'Secure sign-in'}
      cardDescription={phase === 'processing' ? 'Your identity is verified. Recruiter is preparing your workspace.' : 'Continue with the identity used across your Seemplify organization.'}
      footer={<>New to Seemplify? <IdentityTextLink href="/signup">Create an account</IdentityTextLink></>}
    >
      <div className={styles.status} data-tone={phase === 'error' ? 'error' : 'neutral'} role={phase === 'error' ? 'alert' : 'status'}>
        {phase !== 'error' ? <span className={styles.spinner} aria-hidden="true" /> : null}
        <span>{message}</span>
      </div>

      <div className={styles.actions}>
        {phase === 'error' ? (
          <>
            <button className={styles.primary} type="button" onClick={startOidcLogin}>
              Try sign-in again <ArrowRight aria-hidden="true" />
            </button>
            <a className={styles.secondary} href={getIdpBaseUrl()}>Back to App Hub</a>
          </>
        ) : (
          <button className={styles.primary} type="button" onClick={startOidcLogin}>
            Continue securely <ArrowRight aria-hidden="true" />
          </button>
        )}
      </div>
    </IdentityHandoff>
  )
}
