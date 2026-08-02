import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ templateName: string }> }
) {
  try {
    const { templateName } = await params
    
    // Forward the request to the backend
    const backendResponse = await fetch(
      `${process.env.BACKEND_URL || (process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : 'https://api.seemplifyai.com')}/api/candidate-emails/templates/${templateName}`,
      {
        method: 'GET',
        cache: 'no-store',
      }
    )

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json()
      return NextResponse.json(
        { error: errorData.msg || 'Failed to load template' },
        { status: backendResponse.status }
      )
    }

    const templateHTML = await backendResponse.text()
    
    return new NextResponse(templateHTML, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    console.error('Error loading email template:', error)
    return NextResponse.json(
      { error: 'Internal server error loading template' },
      { status: 500 }
    )
  }
}

