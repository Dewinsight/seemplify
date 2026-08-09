import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MAX_MULTIPART_BYTES = 11 * 1024 * 1024

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') || ''
  const contentLength = Number(request.headers.get('content-length') || 0)
  const idempotencyKey = request.headers.get('idempotency-key')
  const capability = request.headers.get('x-public-application-token')
  const jobId = request.headers.get('x-public-job-id')
  const candidateId = request.headers.get('x-public-candidate-id')

  // Reject invalid anonymous requests before buffering or forwarding a body.
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    return NextResponse.json({ code: 'CV_MULTIPART_REQUIRED', error: 'A CV file is required' }, { status: 400 })
  }
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_MULTIPART_BYTES) {
    return NextResponse.json({ code: 'CV_FILE_TOO_LARGE', error: 'CV uploads are limited to 10MB' }, { status: 413 })
  }
  if (!idempotencyKey || !capability || !jobId || !candidateId) {
    return NextResponse.json(
      { code: 'PUBLIC_APPLICATION_CAPABILITY_INVALID', error: 'This public application session is invalid or has expired' },
      { status: 403 },
    )
  }
  if (!request.body) {
    return NextResponse.json({ code: 'CV_FILE_REQUIRED', error: 'No CV file provided' }, { status: 400 })
  }

  const backendBaseUrl = (
    process.env.BACKEND_URL
    || (process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : 'https://api.seemplifyai.com')
  ).replace(/\/$/, '')
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000)

  try {
    // Stream the multipart body so the frontend proxy never buffers an
    // applicant's CV in process memory. Node fetch requires duplex for a
    // ReadableStream request body.
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(contentLength),
        'Idempotency-Key': idempotencyKey,
        'X-Public-Application-Token': capability,
        'X-Public-Job-Id': jobId,
        'X-Public-Candidate-Id': candidateId,
      },
      body: request.body,
      duplex: 'half',
      signal: controller.signal,
    }
    const backendResponse = await fetch(`${backendBaseUrl}/api/candidates/public/upload-cv`, init)
    const payload = await backendResponse.json().catch(() => ({}))
    return NextResponse.json(payload, { status: backendResponse.status })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { code: 'CV_UPLOAD_TIMEOUT', error: 'The CV upload response timed out. Retry to safely recover the same application.' },
        { status: 408 },
      )
    }
    console.error('Public CV proxy failed before durable acceptance')
    return NextResponse.json({ error: 'The CV could not be secured. Please retry.' }, { status: 502 })
  } finally {
    clearTimeout(timeoutId)
  }
}
