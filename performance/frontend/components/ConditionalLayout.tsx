'use client';

import { usePathname } from 'next/navigation';
import Layout from './Layout';

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  // Don't show Layout on login page or root page (root is just a redirect handler)
  if (pathname === '/login' || pathname === '/') {
    return <>{children}</>;
  }
  
  return <Layout>{children}</Layout>;
}







