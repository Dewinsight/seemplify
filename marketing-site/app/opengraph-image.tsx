import { ImageResponse } from 'next/og'
import { headers } from 'next/headers'
import { akwaIbomConfig, getSiteConfig } from './site-config'

export const alt = 'People operations platform'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OpenGraphImage() {
  const requestHeaders = await headers()
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? ''
  const config = getSiteConfig(host.toLowerCase())
  const isAkwaIbom = config === akwaIbomConfig
  const background = isAkwaIbom ? '#f0fdf4' : '#efede7'
  const ink = isAkwaIbom ? '#14532d' : '#171512'
  const accent = isAkwaIbom ? '#15803d' : '#7048e8'

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '70px 76px',
        background,
        color: ink,
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div
          style={{
            width: 52,
            height: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 14,
            background: accent,
            color: '#ffffff',
            fontSize: 25,
            fontWeight: 700,
          }}
        >
          {isAkwaIbom ? 'AK' : 'S'}
        </div>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{config.name}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 980 }}>
        <div style={{ color: accent, fontSize: 20, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' }}>
          {isAkwaIbom ? 'Official human resource portal' : 'One connected people operations suite'}
        </div>
        <div style={{ marginTop: 18, fontFamily: 'Georgia, serif', fontSize: 72, lineHeight: 1.02 }}>
          {isAkwaIbom
            ? 'Fair, transparent public-sector hiring.'
            : 'People work, connected. From hire to payroll.'}
        </div>
        <div style={{ marginTop: 24, maxWidth: 850, fontSize: 25, lineHeight: 1.45, color: isAkwaIbom ? '#3f6212' : '#59544b' }}>
          {config.description}
        </div>
      </div>
    </div>,
    size
  )
}
