'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { useBrandConfig } from '@/context/BrandContext'
import { getIdpBaseUrl } from '@/utils/env'
import styles from './IdentityHandoff.module.css'

interface IdentityHandoffProps {
  eyebrow: string
  title: string
  description: string
  cardIcon: ReactNode
  cardTitle: string
  cardDescription: string
  children: ReactNode
  footer?: ReactNode
}

export function IdentityHandoff({
  eyebrow,
  title,
  description,
  cardIcon,
  cardTitle,
  cardDescription,
  children,
  footer,
}: IdentityHandoffProps) {
  const brand = useBrandConfig()
  const isGovernment = brand.id === 'jetstone'

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brandLink} href={getIdpBaseUrl()} aria-label="Seemplify App Hub">
            {isGovernment ? (
              <img className={styles.governmentLogo} src="/logoakwa.png" alt="Government of Akwa Ibom State" />
            ) : (
              <img className={styles.wordmark} src="https://seemplifyai.com/images/seemplifylogo.png" alt="Seemplify" />
            )}
            <span className={styles.productName}>Recruiter</span>
          </a>
        </div>
      </header>

      <main className={styles.layout}>
        <section className={styles.editorial} aria-labelledby="identity-context-title">
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title} id="identity-context-title">{title}</h1>
          <p className={styles.description}>{description}</p>
          <p className={styles.context}>
            <span>Seemplify identity</span>
            <span className={styles.contextDivider} aria-hidden="true">→</span>
            <span>Recruiter</span>
          </p>
        </section>

        <section className={styles.card} aria-labelledby="identity-card-title">
          <div className={styles.cardIcon} aria-hidden="true">{cardIcon}</div>
          <h2 className={styles.cardTitle} id="identity-card-title">{cardTitle}</h2>
          <p className={styles.cardDescription}>{cardDescription}</p>
          {children}
          {footer ? <div className={styles.footer}>{footer}</div> : null}
        </section>
      </main>
    </div>
  )
}

export { styles as identityHandoffStyles }

export function IdentityTextLink({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith('http')
  return external ? (
    <a className={styles.textLink} href={href}>{children}</a>
  ) : (
    <Link className={styles.textLink} href={href}>{children}</Link>
  )
}
