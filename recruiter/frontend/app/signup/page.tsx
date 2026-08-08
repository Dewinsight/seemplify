'use client'

import { ArrowRight, UserPlus } from 'lucide-react'
import { getIdpBaseUrl } from '@/utils/env'
import {
  IdentityHandoff,
  IdentityTextLink,
  identityHandoffStyles as styles,
} from '@/components/auth/IdentityHandoff'

export default function SignupPage() {
  const signupUrl = `${getIdpBaseUrl()}/signup?utm_source=recruiter&utm_medium=product`

  return (
    <IdentityHandoff
      eyebrow="Create one identity"
      title="Your work starts with one Seemplify account."
      description="Create your identity centrally, then use the same secure account for Recruiter, the App Hub, and every workspace your organization enables."
      cardIcon={<UserPlus />}
      cardTitle="Create your account"
      cardDescription="Account creation is managed by Seemplify so Recruiter never asks you to maintain a second password."
      footer={<>Already have an account? <IdentityTextLink href="/login">Sign in</IdentityTextLink></>}
    >
      <div className={styles.status} role="status">
        <span>Your profile, organization access, and app permissions stay attached to this single identity.</span>
      </div>
      <div className={styles.actions}>
        <a className={styles.primary} href={signupUrl}>
          Create Seemplify identity <ArrowRight aria-hidden="true" />
        </a>
        <a className={styles.secondary} href={getIdpBaseUrl()}>Visit App Hub</a>
      </div>
    </IdentityHandoff>
  )
}
