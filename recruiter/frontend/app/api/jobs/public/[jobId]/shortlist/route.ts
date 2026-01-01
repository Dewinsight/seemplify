import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params
    const shortlistData = await request.json()
    
    // Forward the shortlist request to the backend
    const backendResponse = await fetch(`${process.env.BACKEND_URL || 'http://localhost:5000'}/api/jobs/public/${jobId}/shortlist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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