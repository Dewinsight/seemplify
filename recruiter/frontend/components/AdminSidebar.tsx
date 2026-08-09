"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAdmin } from '@/context/AdminContext';
import {
  LayoutDashboard,
  Users,
  Building2,
  Settings,
  Shield,
  ChevronLeft,
  ChevronRight,
  Key,
  AlertCircle,
  UserCog,
  ArrowUp,
  FileText,
  Calendar,
  Server,
  Coins,
  AudioLines,
  Activity,
  Cpu,
  FileClock
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AdminSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

const AdminSidebar = ({ collapsed = false, onToggle }: AdminSidebarProps) => {
  const pathname = usePathname();
  const { admin, checkPermission, isSuperAdmin } = useAdmin();

  const menuItems = [
    {
      title: 'Dashboard',
      icon: LayoutDashboard,
      href: '/admin/dashboard',
      permission: null // All admins can view dashboard
    },
    {
      title: 'Users',
      icon: Users,
      href: '/admin/users',
      permission: 'manageUsers' as const
    },
    {
      title: 'Organizations',
      icon: Building2,
      href: '/admin/organizations',
      permission: 'manageOrganizations' as const
    },
    {
      title: 'Usage & Activity',
      icon: Activity,
      href: '/admin/activity',
      permission: 'viewAnalytics' as const
    },
    {
      title: 'Admins',
      icon: UserCog,
      href: '/admin/admins',
      permission: null, // Special handling for super admin only
      superAdminOnly: true
    },
    {
      title: 'Calendar Grants',
      icon: Calendar,
      href: '/admin/grants',
      permission: 'systemSettings' as const
    },
    {
      title: 'Nylas Accounts',
      icon: Server,
      href: '/admin/nylas-accounts',
      permission: 'systemSettings' as const
    },
    {
      title: 'Plans',
      icon: FileText,
      href: '/admin/plans',
      permission: 'manageBilling' as const
    },
    {
      title: 'Credits',
      icon: Coins,
      href: '/admin/credits',
      permission: 'manageBilling' as const
    },
    {
      title: 'Licenses',
      icon: Key,
      href: '/admin/licenses',
      permission: 'manageLicenses' as const
    },
    {
      title: 'Subscription Requests',
      icon: ArrowUp,
      href: '/admin/subscription-requests',
      permission: 'manageBilling' as const
    },
    {
      title: 'AI Interviews',
      icon: AudioLines,
      href: '/admin/analytics',
      permission: 'viewAnalytics' as const
    },
    {
      title: 'AI Runtime',
      icon: Cpu,
      href: '/admin/ai-runtime',
      permission: 'viewAnalytics' as const
    },
    {
      title: 'CV Processing',
      icon: FileClock,
      href: '/admin/cv-processing',
      permission: 'viewAnalytics' as const
    },
    {
      title: 'Settings',
      icon: Settings,
      href: '/admin/settings',
      permission: 'systemSettings' as const
    }
  ];

  const filteredMenuItems = menuItems.filter(item => {
    // Special handling for super admin only items
    if (item.superAdminOnly) {
      return isSuperAdmin();
    }
    // Regular permission check
    return !item.permission || checkPermission(item.permission);
  });

  return (
    <div className={cn(
      "flex flex-col bg-gray-800 border-r border-gray-700 transition-all duration-300",
      collapsed ? "w-16" : "w-64"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        {!collapsed && (
          <div className="flex items-center space-x-2">
            <Shield className="h-8 w-8 text-blue-500" />
            <span className="text-xl font-bold text-white">Admin Portal</span>
          </div>
        )}
        <button
          onClick={onToggle}
          className="p-1 rounded-lg hover:bg-gray-700 transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronLeft className="h-5 w-5 text-gray-400" />
          )}
        </button>
      </div>

      {/* Admin Info */}
      {!collapsed && admin && (
        <div className="p-4 border-b border-gray-700">
          <div className="text-sm text-gray-400">Logged in as</div>
          <div className="text-white font-semibold truncate">{admin.name}</div>
          <div className="text-xs text-gray-500 truncate">{admin.email}</div>
          <div className="mt-2">
            <span className={cn(
              "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium",
              admin.role === 'super_admin' 
                ? "bg-gradient-to-r from-yellow-500 to-orange-500 text-white"
                : admin.role === 'admin'
                ? "bg-blue-500 text-white"
                : "bg-gray-600 text-gray-200"
            )}>
              {admin.role.replace('_', ' ').toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4">
        <ul className="space-y-2">
          {filteredMenuItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors",
                    isActive
                      ? "bg-blue-600 text-white"
                      : "text-gray-300 hover:bg-gray-700 hover:text-white",
                    collapsed && "justify-center"
                  )}
                  title={collapsed ? item.title : undefined}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  {!collapsed && <span>{item.title}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700">
        {collapsed ? (
          <button
            className="p-2 rounded-lg hover:bg-gray-700 transition-colors w-full flex justify-center"
            title="System Status"
          >
            <AlertCircle className="h-5 w-5 text-green-400" />
          </button>
        ) : (
          <div className="flex items-center space-x-2">
            <AlertCircle className="h-5 w-5 text-green-400" />
            <div>
              <div className="text-xs text-gray-400">System Status</div>
              <div className="text-sm text-green-400 font-medium">All Systems Operational</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminSidebar;
