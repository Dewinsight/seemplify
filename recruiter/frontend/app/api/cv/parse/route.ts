import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('cv') as File
    
    if (!file) {
      return NextResponse.json(
        { error: 'No CV file provided' },
        { status: 400 }
      )
    }

    // Forward the file to the backend CV parsing service
    const backendFormData = new FormData()
    backendFormData.append('cv', file)

    const backendBaseUrl =
      process.env.BACKEND_URL ||
      (process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : 'https://api.seemplifyai.com');
    const backendResponse = await fetch(`${backendBaseUrl}/api/cv/parse`, {
      method: 'POST',
      body: backendFormData,
    })

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json()
      return NextResponse.json(
        { error: errorData.msg || 'Failed to parse CV' },
        { status: backendResponse.status }
      )
    }

    const parsedData = await backendResponse.json()
    return NextResponse.json(parsedData)
  } catch (error) {
    console.error('Error parsing CV:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 
