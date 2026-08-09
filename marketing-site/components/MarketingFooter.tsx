import Link from 'next/link'
import { idpUrl, siteConfig } from '@/app/site-config'
import SeemplifyLogo from '@/components/SeemplifyLogo'
import MarketingPrivacyChoices from '@/components/MarketingPrivacyChoices'

const productLinks = [
  { href: '/#modules', label: 'Product suite' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#platform', label: 'Platform and security' },
  { href: '/#faq', label: 'Questions' },
]

const marketLinks = [
  { href: '/africa', label: 'Africa overview' },
  { href: '/africa/nigeria', label: 'Nigeria' },
  { href: '/africa/ghana', label: 'Ghana' },
  { href: '/africa/kenya', label: 'Kenya' },
  { href: '/africa/south-africa', label: 'South Africa' },
]

export default function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <div className="marketing-container marketing-footer__inner">
        <div className="marketing-footer__brand-column">
          <Link href="/" className="marketing-footer__brand" aria-label="Seemplify home">
            <SeemplifyLogo size="sm" animated={false} className="marketing-footer__logo" />
          </Link>
          <p className="marketing-footer__statement">
            One operating system for the people work that keeps organisations moving.
          </p>
          <Link
            href={idpUrl('/')}
            className="marketing-footer__sign-in"
            data-track-cta="footer-sign-in"
          >
            Sign in to Seemplify
          </Link>
        </div>

        <nav className="marketing-footer__navigation" aria-label="Footer navigation">
          <div className="marketing-footer__link-group">
            <h2 className="marketing-footer__link-heading">Product</h2>
            <ul className="marketing-footer__link-list">
              {productLinks.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="marketing-footer__link">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="marketing-footer__link-group">
            <h2 className="marketing-footer__link-heading">Africa</h2>
            <ul className="marketing-footer__link-list">
              {marketLinks.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="marketing-footer__link">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="marketing-footer__link-group">
            <h2 className="marketing-footer__link-heading">Company</h2>
            <ul className="marketing-footer__link-list">
              <li>
                <Link href="/privacy-policy" className="marketing-footer__link">
                  Privacy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="marketing-footer__link">
                  Terms
                </Link>
              </li>
              <li>
                <MarketingPrivacyChoices />
              </li>
              <li>
                <a href={`mailto:${siteConfig.contactEmail}`} className="marketing-footer__link">
                  Contact
                </a>
              </li>
            </ul>
          </div>
        </nav>
      </div>

      <div className="marketing-container marketing-footer__legal-row">
        <p className="marketing-footer__copyright">
          &copy; {new Date().getFullYear()} Seemplify. All rights reserved.
        </p>
        <p className="marketing-footer__tagline">Run simple. Run smart.</p>
      </div>
    </footer>
  )
}
