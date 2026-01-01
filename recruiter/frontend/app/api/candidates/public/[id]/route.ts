import { NextRequest, NextResponse } from 'next/server'

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const updateData = await request.json()
    
    // Forward the update request to the backend
    const backendResponse = await fetch(`${process.env.BACKEND_URL || 'http://localhost:5000'}/api/candidates/public/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    })

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json()
      return NextResponse.json(
        { error: errorData.msg || 'Failed to update candidate' },
        { status: backendResponse.status }
      )
    }

    const updatedCandidate = await backendResponse.json()
    return NextResponse.json(updatedCandidate)
  } catch (error) {
    console.error('Error updating candidate:', error)
    return NextResponse.json(
      { error: 'Internal server error during candidate update' },
      { status: 500 }
    )
  }
} 