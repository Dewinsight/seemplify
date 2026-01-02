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

  const getPageTitle = () => {
    const path = pathname?.split('/').filter(Boolean);
    if (!path || path.length < 2) return 'Dashboard';

    const pageName = path[path.length - 1];
    return pageName.charAt(0).toUpperCase() + pageName.slice(1).replace(/-/g, ' ');
  };

  return (
    <header className="bg-[#0a0a0c]/80 backdrop-blur-xl border-b border-white/[0.08] px-4 sm:px-6 py-3 sm:py-4 sticky top-0 z-40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {children}
          <h2 className="text-lg sm:text-xl font-semibold text-white truncate tracking-tight">
            {getPageTitle()}
          </h2>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Notifications */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:flex h-9 w-9 text-zinc-400 hover:text-white hover:bg-white/5"
          >
            <Bell className="h-4 w-4" />
          </Button>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="flex items-center gap-2 text-zinc-300 hover:text-white hover:bg-white/5 p-1.5 sm:p-2 h-auto"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-sm font-semibold">
                    {admin?.name?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="hidden sm:inline max-w-[100px] md:max-w-[200px] truncate text-sm">
                  {admin?.name}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 bg-[#0a0a0c]/95 backdrop-blur-xl border-white/[0.08]"
            >
              <DropdownMenuLabel className="text-zinc-400 text-xs font-normal">
                My Account
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-white/[0.08]" />
              <DropdownMenuItem className="text-zinc-300 hover:text-white hover:bg-white/5 focus:bg-white/5 focus:text-white cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="text-zinc-300 hover:text-white hover:bg-white/5 focus:bg-white/5 focus:text-white cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
              {/* Mobile-only notification menu item */}
              <DropdownMenuItem className="sm:hidden text-zinc-300 hover:text-white hover:bg-white/5 focus:bg-white/5 focus:text-white cursor-pointer">
                <Bell className="mr-2 h-4 w-4" />
                <span>Notifications</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/[0.08]" />
              <DropdownMenuItem
                onClick={logout}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10 focus:bg-red-500/10 focus:text-red-300 cursor-pointer"
              >
                <LogOut className="mr-2 h-4 w-4" />
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
