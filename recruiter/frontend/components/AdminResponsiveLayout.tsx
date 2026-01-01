"use client";

import { useState, useEffect, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';
import { X, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AdminResponsiveLayoutProps {
  children: ReactNode;
}

export default function AdminResponsiveLayout({ children }: AdminResponsiveLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const pathname = usePathname();

  // Check if screen is mobile and set sidebar state accordingly
  useEffect(() => {
    const checkIsMobile = () => {
      const mobile = window.innerWidth < 1024; // lg breakpoint
      setIsMobile(mobile);
      
      // Auto-close sidebar on mobile, auto-open on desktop
      if (sidebarOpen !== !mobile) {
        setSidebarOpen(!mobile);
      }
    };

    // Initial check
    checkIsMobile();

    // Add resize listener
    window.addEventListener('resize', checkIsMobile);
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);

  // Close sidebar when navigating on mobile
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [pathname, isMobile]);

  return (
    <div className="relative min-h-screen bg-gray-900 flex flex-col lg:flex-row">
      {/* Mobile sidebar overlay */}
      {isMobile && sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-20"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <div 
        className={`
          ${isMobile ? 'fixed inset-y-0 left-0 z-30' : 'relative'}
          ${sidebarOpen ? 'translate-x-0' : isMobile ? '-translate-x-full' : 'w-0 overflow-hidden'}
          transition-all duration-300 ease-in-out
        `}
      >
        <AdminSidebar collapsed={!sidebarOpen && !isMobile} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Header with mobile menu button */}
        <div className="sticky top-0 z-10">
          <AdminHeader>
            {isMobile && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="mr-2 text-gray-400 hover:text-white hover:bg-gray-700"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            )}
          </AdminHeader>
        </div>

        {/* Main content area */}
        <main className="flex-1 overflow-y-auto bg-gray-900 p-4 sm:p-6">
          <div className="w-full mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
