import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  Clock3,
  GraduationCap,
  ShieldCheck,
  Target,
  UsersRound,
  WalletCards,
  Waypoints,
} from 'lucide-react'
import Link from 'next/link'
import type { ProductPageData, ProductVisualKind } from '@/app/products/product-data'
import { productPages } from '@/app/products/product-data'
import { absoluteUrl, idpUrl, siteConfig } from '@/app/site-config'

const productHref = (slug: string) => (slug === 'recruiter' ? siteConfig.recruiterSiteUrl : `/products/${slug}`)
import { BookDemoButton } from '@/components/BookDemoModal'
import JsonLd from '@/components/JsonLd'
import MarketingPageShell from '@/components/MarketingPageShell'
import ProductShowcase from '@/components/ProductShowcase'
import RecruiterWorkflowShowcase from '@/components/RecruiterWorkflowShowcase'
import styles from './ProductDetailPage.module.css'

const productIcons = {
  recruiter: BriefcaseBusiness,
  'core-hr': UsersRound,
  leave: CalendarDays,
  performance: Target,
  time: Clock3,
  payroll: WalletCards,
  experience: Waypoints,
  learning: GraduationCap,
} satisfies Record<ProductVisualKind, typeof BriefcaseBusiness>

function structuredData(product: ProductPageData) {
  const pageUrl = absoluteUrl(`/products/${product.slug}`)

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name: `${product.name} | ${siteConfig.name}`,
        url: pageUrl,
        description: product.summary,
        isPartOf: { '@type': 'WebSite', name: siteConfig.name, url: siteConfig.url },
      },
      {
        '@type': 'SoftwareApplication',
        name: `${siteConfig.name} ${product.name}`,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: pageUrl,
        description: product.summary,
        featureList: product.capabilities.map((capability) => capability.title),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: siteConfig.url },
          { '@type': 'ListItem', position: 2, name: 'Products', item: absoluteUrl('/#modules') },
          { '@type': 'ListItem', position: 3, name: product.name, item: pageUrl },
        ],
      },
    ],
  }
}

export default function ProductDetailPage({ product }: { product: ProductPageData }) {
  const Icon = productIcons[product.visual]
  const productIndex = productPages.findIndex((entry) => entry.slug === product.slug)
  const previous = productPages[(productIndex - 1 + productPages.length) % productPages.length]
  const next = productPages[(productIndex + 1) % productPages.length]

  return (
    <MarketingPageShell>
      <JsonLd data={structuredData(product)} />

      <article className={styles.page}>
        <div className="marketing-container">
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
            <ol>
              <li><Link href="/">Home</Link></li>
              <li><Link href="/#modules">Products</Link></li>
              <li><span aria-current="page">{product.name}</span></li>
            </ol>
          </nav>

          <header className={`${styles.hero} marketing-product-hero`}>
            <div className={styles.heroCopy}>
              <div className={styles.productIdentity}>
                <Icon aria-hidden="true" size={22} />
                <span>{product.audience}</span>
                {product.status ? <strong>{product.status}</strong> : null}
              </div>
              <h1>{product.name}</h1>
              <p className={`${styles.heroStatement} marketing-product-hero-statement`}>{product.title}</p>
              <p className={`${styles.heroSummary} marketing-product-hero-summary`}>{product.summary}</p>
              <div className={styles.heroActions}>
                <Link
                  href={idpUrl('/signup')}
                  className="marketing-button marketing-button--primary"
                  data-track-cta={`product-${product.slug}-start-trial`}
                >
                  Start your 7-day trial <ArrowRight aria-hidden="true" size={17} />
                </Link>
                <BookDemoButton
                  className="marketing-button marketing-button--secondary"
                  trackingLabel={`product-${product.slug}-book-demo`}
                >
                  Book a demo
                </BookDemoButton>
              </div>
            </div>

            <div className={styles.visualColumn}>
              <ProductShowcase product={product} />
              <aside className={styles.boundary} aria-labelledby={`${product.slug}-boundary-title`}>
                <ShieldCheck aria-hidden="true" size={20} />
                <div>
                  <h2 id={`${product.slug}-boundary-title`}>{product.boundary.title}</h2>
                  <p>{product.boundary.description}</p>
                  {product.slug === 'payroll' ? <Link href="/africa">Review published regional coverage <ArrowRight aria-hidden="true" size={15} /></Link> : null}
                </div>
              </aside>
            </div>
          </header>
        </div>

        {product.slug === 'recruiter' ? <RecruiterWorkflowShowcase /> : null}

        <section className={styles.section} aria-labelledby={`${product.slug}-capabilities`}>
          <div className="marketing-container">
            <div className={styles.sectionHeading}>
              <h2 id={`${product.slug}-capabilities`}>What {product.name} supports</h2>
              <p>Focused capabilities drawn from the work people complete in this Seemplify workspace.</p>
            </div>
            <div className={styles.capabilityRows}>
              {product.capabilities.map((capability, index) => (
                <article key={capability.title}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div><h3>{capability.title}</h3><p>{capability.description}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.workflowSection}`} aria-labelledby={`${product.slug}-workflow`}>
          <div className={`marketing-container ${styles.workflowLayout}`}>
            <div className={styles.sectionHeading}>
              <h2 id={`${product.slug}-workflow`}>How the work moves</h2>
              <p>The workflow stays explicit from the first record to the reviewed outcome.</p>
            </div>
            <ol className={styles.workflow}>
              {product.workflow.map((step, index) => (
                <li key={step.title}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div><h3>{step.title}</h3><p>{step.description}</p></div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section} aria-labelledby={`${product.slug}-connections`}>
          <div className={`marketing-container ${styles.connectionsLayout}`}>
            <div className={styles.sectionHeading}>
              <h2 id={`${product.slug}-connections`}>What this connects to</h2>
              <p>Carry the person and decision context into the next workspace while each product keeps its own records and controls.</p>
            </div>
            <div className={styles.connections}>
              {product.connections.map((connection) => (
                <Link href={connection.href} key={connection.href}>
                  <div><strong>{connection.product}</strong><p>{connection.description}</p></div>
                  <ArrowRight aria-hidden="true" size={18} />
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.controlSection} aria-labelledby={`${product.slug}-controls`}>
          <div className="marketing-container">
            <div className={styles.sectionHeading}>
              <h2 id={`${product.slug}-controls`}>Control stays visible</h2>
              <p>Shared identity provides the starting context. Each workspace still applies its own permissions, records and review rules.</p>
            </div>
            <ul className={styles.controlList}>
              <li><Check aria-hidden="true" size={18} /><span><strong>One signed-in identity</strong> across the Seemplify workspaces your organisation enables.</span></li>
              <li><Check aria-hidden="true" size={18} /><span><strong>Organisation and role context</strong> supplied to the workspace responsible for the action.</span></li>
              <li><Check aria-hidden="true" size={18} /><span><strong>Product-specific boundaries</strong> kept beside AI, location, statutory or decision-making claims.</span></li>
            </ul>
          </div>
        </section>

        <nav className={styles.adjacent} aria-label="More Seemplify products">
          <div className="marketing-container">
            <h2>Continue through the suite</h2>
            <div>
              <Link href={productHref(previous.slug)} rel="prev"><ArrowLeft aria-hidden="true" size={17} /><span><small>Previous</small><strong>{previous.navigationName}</strong></span></Link>
              <Link href={productHref(next.slug)} rel="next"><span><small>Next</small><strong>{next.navigationName}</strong></span><ArrowRight aria-hidden="true" size={17} /></Link>
            </div>
          </div>
        </nav>

        <section className={styles.cta}>
          <div className={`marketing-container ${styles.ctaInner}`}>
            <div><h2>See {product.name} in your own workflow.</h2><p>Bring us the process you want to improve and we will walk through the relevant workspace and its boundaries.</p></div>
            <div>
              <BookDemoButton className="marketing-button marketing-button--primary" trackingLabel={`product-${product.slug}-footer-demo`}>Book a demo</BookDemoButton>
              <Link href="/#modules" className="marketing-button marketing-button--secondary">View all products</Link>
            </div>
          </div>
        </section>
      </article>
    </MarketingPageShell>
  )
}
