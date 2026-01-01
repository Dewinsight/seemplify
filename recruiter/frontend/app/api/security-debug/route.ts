import { NextResponse } from 'next/server';

export async function GET() {
  // Get a new response object
  const response = NextResponse.json({
    message: 'Security headers debug endpoint',
    time: new Date().toISOString(),
    info: 'Use this to verify security headers are correctly applied'
  });

  // List of all headers that should be applied by next.config.js
  const expectedHeaders = [
    'Content-Security-Policy',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'Strict-Transport-Security'
  ];

  // Return all response headers for debugging
  return response;
}
