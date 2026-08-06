import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('resume') as File
    const jobId = String(formData.get('jobId') || '').trim()
    
    if (!file || !jobId) {
      return NextResponse.json(
        { error: !file ? 'No CV file provided' : 'No public job ID provided' },
        { status: 400 }
      )
    }

    // Forward the file to the backend candidate upload service
    const backendFormData = new FormData()
    backendFormData.append('resume', file)
    backendFormData.append('jobId', jobId)
    // The applicant's candidate record must travel too, or the analysis
    // creates a duplicate candidate instead of enriching theirs.
    const candidateId = String(formData.get('candidateId') || '').trim()
    if (candidateId) backendFormData.append('candidateId', candidateId)

    // Increase timeout to 10 minutes for CV processing
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000) // 10 minutes

    try {
      const backendBaseUrl =
        process.env.BACKEND_URL ||
        (process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : 'https://api.seemplifyai.com');
      const backendResponse = await fetch(`${backendBaseUrl}/api/candidates/public/upload-cv`, {
        method: 'POST',
        headers: {
          ...(request.headers.get('idempotency-key')
            ? { 'Idempotency-Key': request.headers.get('idempotency-key') as string }
            : {}),
        },
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
      return NextResponse.json(candidateData, { status: backendResponse.status })
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
