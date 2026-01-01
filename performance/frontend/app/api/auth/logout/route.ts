import { NextResponse } from 'next/server';

export async function POST() {
  // Clear any custom cookies or server-side sessions if needed
  const response = NextResponse.json({ success: true });
  
  // Clear session cookie
  response.cookies.set('next-auth.session-token', '', {
    maxAge: 0,
    path: '/',
  });
  
  return response;
}






