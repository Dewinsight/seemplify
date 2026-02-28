import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { templateName: string } }
) {
  try {
    const { templateName } = params
    
    // Forward the request to the backend
    const backendResponse = await fetch(
      `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/candidate-emails/templates/${templateName}`,
      {
        method: 'GET',
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

