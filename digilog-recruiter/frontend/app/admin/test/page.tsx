"use client";

import { usePathname } from 'next/navigation';

export default function AdminTestPage() {
  const pathname = usePathname();
  
  console.log('🧪 AdminTestPage rendered! Pathname:', pathname);
  
  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <h1 className="text-2xl font-bold">Admin Test Page</h1>
      <p>If you can see this, admin routes are working!</p>
      <p className="text-gray-400 mt-2">Current pathname: {pathname}</p>
      <div className="mt-4">
        <a href="/admin/login" className="text-blue-400 hover:text-blue-300 mr-4 inline-block">
          Go to Admin Login →
        </a>
        <a href="/admin/dashboard" className="text-green-400 hover:text-green-300 inline-block">
          Go to Admin Dashboard →
        </a>
      </div>
    </div>
  );
}
