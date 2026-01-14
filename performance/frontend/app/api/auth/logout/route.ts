import { NextResponse } from 'next/server';

export async function POST() {
  // Create a redirect response to the login page
  const response = NextResponse.redirect(new URL('/login', process.env.NEXTAUTH_URL || 'http://localhost:5005'), 302);
  
  // Clear session cookie
  response.cookies.set('next-auth.session-token', '', {
    maxAge: 0,
    path: '/',
  });
  
  return response;
}
