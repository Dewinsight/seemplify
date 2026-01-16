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
  BarChart3,
  AlertCircle,
  UserCog,
  ArrowUp,
  FileText,
  Calendar,
  Server,
  Coins
} from 'lucide-react';
import { cn } from '@/lib/utils';
import SeemplifyLogo from '@/components/SeemplifyLogo';

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
      permission: null
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
      title: 'Admins',
      icon: UserCog,
      href: '/admin/admins',
      permission: null,
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
      title: 'Analytics',
      icon: BarChart3,
      href: '/admin/analytics',
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
    if (item.superAdminOnly) {
      return isSuperAdmin();
    }
    return !item.permission || checkPermission(item.permission);
  });

  return (
    <div className={cn(
      "flex flex-col bg-[#0a0a0c] border-r border-white/[0.08] transition-all duration-300",
      collapsed ? "w-16" : "w-64"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/[0.08]">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <SeemplifyLogo size="sm" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-white tracking-tight">Seemplify</span>
              <span className="text-xs text-zinc-500">Admin Portal</span>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-full flex justify-center">
            <SeemplifyLogo size="sm" />
          </div>
        )}
        <button
          onClick={onToggle}
          className={cn(
            "p-1.5 rounded-lg hover:bg-white/5 transition-colors",
            collapsed && "hidden"
          )}
        >
          <ChevronLeft className="h-4 w-4 text-zinc-500" />
        </button>
      </div>

      {/* Admin Info */}
      {!collapsed && admin && (
        <div className="p-4 border-b border-white/[0.08]">
          <div className="p-3 rounded-xl bg-white/[0.03]">
            <div className="text-xs text-zinc-500 mb-1">Logged in as</div>
            <div className="text-sm text-white font-medium truncate">{admin.name}</div>
            <div className="text-xs text-zinc-500 truncate mb-2">{admin.email}</div>
            <span className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wide",
              admin.role === 'super_admin'
                ? "bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-400 border border-amber-500/20"
                : admin.role === 'admin'
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/20"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700"
            )}>
              {admin.role.replace('_', ' ')}
            </span>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {filteredMenuItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                    isActive
                      ? "bg-white/10 text-white"
                      : "text-zinc-400 hover:bg-white/5 hover:text-white",
                    collapsed && "justify-center px-2"
                  )}
                  title={collapsed ? item.title : undefined}
                >
                  <Icon className={cn(
                    "h-4 w-4 flex-shrink-0",
                    isActive && "text-blue-400"
                  )} />
                  {!collapsed && <span className="text-sm">{item.title}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-white/[0.08]">
        {collapsed ? (
          <button
            className="p-2 rounded-lg hover:bg-white/5 transition-colors w-full flex justify-center"
            title="System Status"
          >
            <AlertCircle className="h-4 w-4 text-emerald-400" />
          </button>
        ) : (
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-white/[0.03]">
            <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            <div>
              <div className="text-xs text-zinc-500">System Status</div>
              <div className="text-xs text-emerald-400 font-medium">All Systems Operational</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminSidebar;
