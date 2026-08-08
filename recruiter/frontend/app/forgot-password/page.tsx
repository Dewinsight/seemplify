'use client'

import { ArrowRight, KeyRound } from 'lucide-react'
import { getIdpBaseUrl } from '@/utils/env'
import {
  IdentityHandoff,
  IdentityTextLink,
  identityHandoffStyles as styles,
} from '@/components/auth/IdentityHandoff'

export default function ForgotPasswordPage() {
  const recoveryUrl = `${getIdpBaseUrl()}/forgot-password`

  return (
    <IdentityHandoff
      eyebrow="Account recovery"
      title="Recover access to every connected app."
      description="Your Recruiter access uses your central Seemplify identity. Reset it once and the new password applies wherever that identity is used."
      cardIcon={<KeyRound />}
      cardTitle="Reset your password"
      cardDescription="Continue to the secure identity service to request a reset link. Recruiter does not store a separate sign-in password."
      footer={<>Remembered your password? <IdentityTextLink href="/login">Back to sign in</IdentityTextLink></>}
    >
      <div className={styles.status} role="status">
        <span>For privacy, Seemplify always returns the same confirmation whether or not an email address is registered.</span>
      </div>
      <div className={styles.actions}>
        <a className={styles.primary} href={recoveryUrl}>
          Continue to password reset <ArrowRight aria-hidden="true" />
        </a>
        <a className={styles.secondary} href={getIdpBaseUrl()}>Back to App Hub</a>
      </div>
    </IdentityHandoff>
  )
}
