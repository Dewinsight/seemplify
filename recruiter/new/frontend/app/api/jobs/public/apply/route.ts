import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const applicationData = await request.json()
    
    // Validate required fields
    if (!applicationData.firstName || !applicationData.lastName || !applicationData.email || !applicationData.jobId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Forward the application to the backend
    const backendResponse = await fetch(`${process.env.BACKEND_URL || 'http://localhost:5000'}/api/jobs/public/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(applicationData)
    })

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json()
      return NextResponse.json(
        { error: errorData.msg || 'Failed to submit application' },
        { status: backendResponse.status }
      )
    }

    const result = await backendResponse.json()
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error submitting public application:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 