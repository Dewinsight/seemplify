'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import {
    LayoutGrid,
    Clock,
    Calendar,
    CheckCircle2,
    Settings,
    Menu,
    X,
    ChevronDown,
    Building2,
    LogOut,
    BarChart3,
    Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
    name: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    adminOnly?: boolean;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { user, logout, switchOrganization } = useAuth();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [orgMenuOpen, setOrgMenuOpen] = useState(false);

    // Determine if user has admin/manager access
    const currentOrgRole = user?.currentOrganization?.role;
    const isManager = user?.teams?.some(t =>
        t.organizationId === user?.currentOrganization?.id &&
        ['line_manager', 'team_lead'].includes(t.role)
    );
    const isAdmin = ['owner', 'admin', 'hr_manager'].includes(currentOrgRole);

    const navigation: NavItem[] = [
        { name: 'Dashboard', href: '/dashboard', icon: LayoutGrid },
        { name: 'My Timesheets', href: '/timesheets', icon: Calendar },
        { name: 'Punch Log', href: '/entries', icon: Clock },
    ];

    const adminNavigation: NavItem[] = [
        { name: 'Approvals', href: '/approvals', icon: CheckCircle2 },
        { name: 'Team Attendance', href: '/team', icon: Users },
    ];

    if (isAdmin) {
        adminNavigation.push(
            { name: 'Reports', href: '/reports', icon: BarChart3 },
            { name: 'Settings', href: '/admin/settings', icon: Settings }
        );
    }

    const isLoginPage = pathname === '/login';

    if (isLoginPage) {
        return <>{children}</>;
    }

    const showAdminSection = isAdmin || isManager;

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-teal-500/30">
            <div className="bg-noise" />

            {/* Navbar */}
            <nav className="fixed top-0 left-0 right-0 z-50 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-xl">
                <div className="mx-auto px-4 lg:px-8 max-w-7xl">
                    <div className="flex h-16 items-center justify-between">
                        {/* Logo */}
                        <Link href="/" className="flex items-center gap-3 group">
                            <div className="relative h-10 w-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-teal-500/20 transition-transform duration-300 group-hover:scale-105">
                                <Clock className="h-5 w-5 text-white" />
                            </div>
                            <div className="hidden sm:block">
                                <div className="text-sm font-semibold text-white">Time & Attendance</div>
                                <div className="text-xs text-zinc-400">by Seemplify</div>
                            </div>
                        </Link>

                        {/* Desktop Nav */}
                        <div className="hidden lg:flex items-center gap-1">
                            {navigation.map((item) => (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={cn(
                                        'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                                        pathname === item.href || (pathname.startsWith(item.href) && item.href !== '/dashboard')
                                            ? 'bg-zinc-800/80 text-white shadow-sm ring-1 ring-white/10'
                                            : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                                    )}
                                >
                                    <item.icon className="h-4 w-4" />
                                    {item.name}
                                </Link>
                            ))}

                            {showAdminSection && (
                                <>
                                    <div className="h-4 w-px bg-zinc-800 mx-2" />
                                    {adminNavigation.map((item) => (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={cn(
                                                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                                                pathname === item.href || pathname.startsWith(item.href)
                                                    ? 'bg-zinc-800/80 text-white shadow-sm ring-1 ring-white/10'
                                                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                                            )}
                                        >
                                            <item.icon className="h-4 w-4" />
                                            {item.name}
                                        </Link>
                                    ))}
                                </>
                            )}
                        </div>

                        {/* Right Side Actions */}
                        <div className="flex items-center gap-3">
                            {/* Org Switcher */}
                            <div className="relative hidden md:block">
                                <button
                                    onClick={() => setOrgMenuOpen(!orgMenuOpen)}
                                    className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800/70 transition-colors"
                                >
                                    <Building2 className="h-4 w-4 text-teal-500" />
                                    <span className="max-w-[120px] truncate">{user?.currentOrganization?.name || 'Organization'}</span>
                                    <ChevronDown className="h-4 w-4 text-zinc-500" />
                                </button>

                                {orgMenuOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setOrgMenuOpen(false)} />
                                        <div className="absolute right-0 top-12 w-64 rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden z-50">
                                            {user?.organizations?.map((org) => (
                                                <button
                                                    key={org.id}
                                                    onClick={() => switchOrganization(org.id)}
                                                    className={cn(
                                                        'w-full text-left px-4 py-3 text-sm hover:bg-zinc-900 transition-colors border-b border-zinc-900 last:border-0',
                                                        org.id === user?.currentOrganization?.id && 'bg-zinc-900 text-teal-400'
                                                    )}
                                                >
                                                    <div className="font-medium">{org.name}</div>
                                                    <div className="text-xs text-zinc-500 capitalize">{org.role.replace('_', ' ')}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* User Menu */}
                            <div className="relative">
                                <button
                                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                                    className="flex items-center gap-2 rounded-full hover:bg-zinc-800/50 p-1 transition-colors"
                                >
                                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center ring-2 ring-zinc-950 shadow-lg shadow-teal-500/10">
                                        <span className="text-sm font-semibold text-white">{user?.name?.charAt(0) || 'U'}</span>
                                    </div>
                                </button>

                                {userMenuOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                                        <div className="absolute right-0 top-12 w-56 rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden z-50">
                                            <div className="p-4 border-b border-zinc-800/60 bg-zinc-900/30">
                                                <div className="text-sm font-medium text-white truncate">{user?.name}</div>
                                                <div className="text-xs text-zinc-500 truncate">{user?.email}</div>
                                            </div>
                                            <div className="p-1">
                                                <button
                                                    onClick={logout}
                                                    className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors flex items-center gap-2"
                                                >
                                                    <LogOut className="h-4 w-4" />
                                                    Sign Out
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Mobile Menu Button */}
                            <button
                                className="lg:hidden p-2 rounded-lg hover:bg-zinc-800/50 text-zinc-400 hover:text-white"
                                onClick={() => setMobileOpen(true)}
                            >
                                <Menu className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Main Content */}
            <main className="pt-20 pb-10 px-4 lg:px-8 max-w-7xl mx-auto">
                {children}
            </main>

            {/* Mobile Menu Overlay */}
            {mobileOpen && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
                    <div className="fixed inset-y-0 right-0 w-full max-w-xs bg-zinc-950 border-l border-zinc-800 shadow-2xl p-6">
                        <div className="flex items-center justify-between mb-8">
                            <span className="text-lg font-semibold text-white">Menu</span>
                            <button onClick={() => setMobileOpen(false)}>
                                <X className="h-5 w-5 text-zinc-400" />
                            </button>
                        </div>

                        <div className="space-y-6">
                            <div className="space-y-2">
                                <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider px-2">Navigation</div>
                                {navigation.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={() => setMobileOpen(false)}
                                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/50"
                                    >
                                        <item.icon className="h-5 w-5" />
                                        {item.name}
                                    </Link>
                                ))}
                            </div>

                            {showAdminSection && (
                                <div className="space-y-2">
                                    <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider px-2">Management</div>
                                    {adminNavigation.map((item) => (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            onClick={() => setMobileOpen(false)}
                                            className="flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/50"
                                        >
                                            <item.icon className="h-5 w-5" />
                                            {item.name}
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
