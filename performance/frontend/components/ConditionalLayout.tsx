'use client';

import { usePathname } from 'next/navigation';
import Layout from './Layout';
import PageGuide from './PageGuide';

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  // Don't show Layout on root page (root is just a redirect handler)
  if (pathname === '/') {
    return <>{children}</>;
  }

  if (pathname === '/login') {
    return (
      <>
        {children}
        <PageGuide pathnameOverride="/login" showBanner={false} />
      </>
    );
  }
  
  return <Layout>{children}</Layout>;
}







