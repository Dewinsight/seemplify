import { NextResponse } from 'next/server'
import { idpUrl } from '@/app/site-config'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const response = await fetch(idpUrl('/api/public/book-demo'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const payload = await response.json().catch(() => ({ error: 'Failed to submit demo request' }))
    if (!response.ok) {
      return NextResponse.json(payload, { status: response.status })
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error('Demo proxy error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
