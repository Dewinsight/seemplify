import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params
    
    // Forward the request to the backend
    const backendBaseUrl =
      process.env.BACKEND_URL ||
      (process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : 'https://172-182-227-84.nip.io');
    const backendResponse = await fetch(`${backendBaseUrl}/api/jobs/public/${jobId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })
    
    if (!backendResponse.ok) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: backendResponse.status }
      )
    }
    
    const jobData = await backendResponse.json()
    return NextResponse.json(jobData)
  } catch (error) {
    console.error('Error fetching public job:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 
