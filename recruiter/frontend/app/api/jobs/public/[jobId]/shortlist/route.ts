import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params
    const shortlistData = await request.json()
    
    // Forward the shortlist request to the backend
    const backendBaseUrl =
      process.env.BACKEND_URL ||
      (process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : 'https://api.seemplifyai.com');
    const backendResponse = await fetch(`${backendBaseUrl}/api/jobs/public/${jobId}/shortlist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(request.headers.get('idempotency-key')
          ? { 'Idempotency-Key': request.headers.get('idempotency-key') as string }
          : {}),
        ...(request.headers.get('x-public-application-token')
          ? { 'X-Public-Application-Token': request.headers.get('x-public-application-token') as string }
          : {}),
      },
      body: JSON.stringify(shortlistData),
    })

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json()
      return NextResponse.json(
        { error: errorData.msg || 'Failed to add candidate to shortlist' },
        { status: backendResponse.status }
      )
    }

    const result = await backendResponse.json()
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error adding candidate to shortlist:', error)
    return NextResponse.json(
      { error: 'Internal server error during shortlist operation' },
      { status: 500 }
    )
  }
} 
