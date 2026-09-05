import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { productPageBySlug, productPages } from '@/app/products/product-data'
import { absoluteUrl, siteConfig } from '@/app/site-config'
import ProductDetailPage from '@/components/ProductDetailPage'

type ProductRouteProps = {
  params: Promise<{ product: string }>
}

// Recruiter is served by its own site (siteConfig.recruiterSiteUrl); it is not pre-rendered here.
export function generateStaticParams() {
  return productPages.filter((product) => product.slug !== 'recruiter').map((product) => ({ product: product.slug }))
}

export async function generateMetadata({ params }: ProductRouteProps): Promise<Metadata> {
  const { product: slug } = await params
  const product = productPageBySlug[slug]
  if (!product) return {}

  const title = `${product.name} software`
  const canonical = `/products/${product.slug}`

  return {
    title,
    description: product.summary,
    alternates: { canonical },
    openGraph: {
      title: `${product.name} | ${siteConfig.name}`,
      description: product.summary,
      type: 'website',
      url: absoluteUrl(canonical),
      siteName: siteConfig.name,
      images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: `${siteConfig.name} ${product.name}` }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${product.name} | ${siteConfig.name}`,
      description: product.summary,
      images: [siteConfig.ogImage],
    },
  }
}

export default async function ProductPage({ params }: ProductRouteProps) {
  const { product: slug } = await params
  if (slug === 'recruiter') redirect(siteConfig.recruiterSiteUrl)
  const product = productPageBySlug[slug]
  if (!product) notFound()

  return <ProductDetailPage product={product} />
}
