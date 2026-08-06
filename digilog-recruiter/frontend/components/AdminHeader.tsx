"use client";

import { ReactNode } from 'react';
import { useAdmin } from '@/context/AdminContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Bell, LogOut, User, Settings } from 'lucide-react';
import { usePathname } from 'next/navigation';

interface AdminHeaderProps {
  children?: ReactNode;
}

const AdminHeader = ({ children }: AdminHeaderProps) => {
  const { admin, logout } = useAdmin();
  const pathname = usePathname();
  
  // Extract page title from pathname
  const getPageTitle = () => {
    const path = pathname?.split('/').filter(Boolean);
    if (!path || path.length < 2) return 'Dashboard';
    
    // Get the last part of the path and format it
    const pageName = path[path.length - 1];
    return pageName.charAt(0).toUpperCase() + pageName.slice(1).replace(/-/g, ' ');
  };

  return (
    <header className="bg-gray-800 border-b border-gray-700 px-4 sm:px-6 py-3 sm:py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 sm:space-x-4">
          {children}
          <h2 className="text-lg sm:text-xl font-semibold text-white truncate">
            {getPageTitle()}
          </h2>
        </div>

        <div className="flex items-center space-x-2 sm:space-x-4">
          {/* Notifications - Hidden on smallest screens */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:flex text-gray-400 hover:text-white hover:bg-gray-700"
          >
            <Bell className="h-5 w-5" />
          </Button>

          {/* User Menu - Optimized for mobile */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="flex items-center space-x-2 text-gray-300 hover:text-white hover:bg-gray-700 p-1 sm:p-2"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-r from-[#754BE5] to-[#6935CF] flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-sm font-semibold">
                    {admin?.name?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="hidden sm:inline max-w-[100px] md:max-w-[200px] truncate">
                  {admin?.name}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-gray-800 border-gray-700">
              <DropdownMenuLabel className="text-gray-300">My Account</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-gray-700" />
              <DropdownMenuItem className="text-gray-300 hover:text-white hover:bg-gray-700 focus:bg-gray-700">
                <User className="mr-2 h-5 w-5" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="text-gray-300 hover:text-white hover:bg-gray-700 focus:bg-gray-700">
                <Settings className="mr-2 h-5 w-5" />
                <span>Settings</span>
              </DropdownMenuItem>
              {/* Mobile-only notification menu item */}
              <DropdownMenuItem className="sm:hidden text-gray-300 hover:text-white hover:bg-gray-700 focus:bg-gray-700">
                <Bell className="mr-2 h-5 w-5" />
                <span>Notifications</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-gray-700" />
              <DropdownMenuItem
                onClick={logout}
                className="text-red-400 hover:text-red-300 hover:bg-gray-700 focus:bg-gray-700"
              >
                <LogOut className="mr-2 h-5 w-5" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};

export default AdminHeader;
