import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('resume') as File
    
    if (!file) {
      return NextResponse.json(
        { error: 'No CV file provided' },
        { status: 400 }
      )
    }

    // Forward the file to the backend candidate upload service
    const backendFormData = new FormData()
    backendFormData.append('resume', file)

    // Increase timeout to 10 minutes for CV processing
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000) // 10 minutes

    try {
      const backendResponse = await fetch(`${process.env.BACKEND_URL || 'http://localhost:5000'}/api/candidates/public/upload-cv`, {
        method: 'POST',
        body: backendFormData,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!backendResponse.ok) {
        const errorData = await backendResponse.json()
        return NextResponse.json(
          { error: errorData.msg || 'Failed to upload and process CV' },
          { status: backendResponse.status }
        )
      }

      const candidateData = await backendResponse.json()
      return NextResponse.json(candidateData)
    } catch (error: any) {
      clearTimeout(timeoutId)
      if (error.name === 'AbortError') {
        return NextResponse.json(
          { error: 'CV processing is taking longer than expected. Please try again or contact support.' },
          { status: 408 }
        )
      }
      throw error
    }
  } catch (error) {
    console.error('Error uploading CV:', error)
    return NextResponse.json(
      { error: 'Internal server error during CV upload' },
      { status: 500 }
    )
  }
} 