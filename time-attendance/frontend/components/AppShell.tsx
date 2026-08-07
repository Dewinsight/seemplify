'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import {
    BarChart3,
    Building2,
    Calendar,
    Check,
    CheckCircle2,
    ChevronDown,
    Clock,
    LayoutGrid,
    LogOut,
    Menu,
    Settings,
    Users,
    X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
    name: string;
    label: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
}

const personalNavigation: NavItem[] = [
    { name: 'Dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutGrid },
    { name: 'My Timesheets', label: 'Timesheets', href: '/timesheets', icon: Calendar },
    { name: 'Punch Log', label: 'Punches', href: '/entries', icon: Clock },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { user, logout, switchOrganization, isLoading, isAuthenticated } = useAuth();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [orgMenuOpen, setOrgMenuOpen] = useState(false);

    useEffect(() => {
        setMobileOpen(false);
        setUserMenuOpen(false);
        setOrgMenuOpen(false);
    }, [pathname]);

    const publicRoutes = ['/login', '/oidc/callback'];
    const isPublicRoute = publicRoutes.some(route => pathname?.startsWith(route));

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-zinc-950">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-800 border-t-teal-400" />
            </div>
        );
    }

    if (!isAuthenticated && !isPublicRoute) return null;
    if (isPublicRoute || pathname === '/login') return <>{children}</>;

    const currentOrgRole = user?.currentOrganization?.role;
    const isManager = user?.teams?.some(team =>
        team.organizationId === user?.currentOrganization?.id &&
        ['line_manager', 'team_lead'].includes(team.role)
    );
    const isAdmin = ['owner', 'admin', 'hr_manager'].includes(currentOrgRole);
    const showManagement = isAdmin || isManager;

    const managementNavigation: NavItem[] = [
        { name: 'Approvals', label: 'Approvals', href: '/approvals', icon: CheckCircle2 },
        { name: 'Team Attendance', label: 'Team', href: '/team', icon: Users },
        ...(isAdmin
            ? [
                { name: 'Reports', label: 'Reports', href: '/reports', icon: BarChart3 },
                { name: 'Settings', label: 'Settings', href: '/admin/settings', icon: Settings },
            ]
            : []),
    ];

    const desktopNavigation = showManagement
        ? [...personalNavigation, ...managementNavigation]
        : personalNavigation;

    const isActive = (item: NavItem) =>
        pathname === item.href ||
        (item.href !== '/dashboard' && Boolean(pathname?.startsWith(`${item.href}/`)));

    const toggleOrganizationMenu = () => {
        setOrgMenuOpen(open => !open);
        setUserMenuOpen(false);
    };

    const toggleUserMenu = () => {
        setUserMenuOpen(open => !open);
        setOrgMenuOpen(false);
    };

    const selectOrganization = (organizationId: string) => {
        setOrgMenuOpen(false);
        setMobileOpen(false);
        void switchOrganization(organizationId);
    };

    const renderNavigationLink = (item: NavItem, mobile = false) => {
        const active = isActive(item);

        return (
            <Link
                key={item.href}
                href={item.href}
                title={item.name}
                aria-current={active ? 'page' : undefined}
                onClick={() => mobile && setMobileOpen(false)}
                className={cn(
                    mobile
                        ? 'flex min-h-12 items-center gap-3 border px-3 text-sm font-medium transition-colors'
                        : 'relative flex h-16 items-center gap-2 px-3 text-[13px] font-medium transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-transparent after:content-[\'\']',
                    active
                        ? mobile
                            ? 'border-zinc-700 bg-zinc-900 text-white'
                            : 'text-white after:bg-teal-400'
                        : mobile
                            ? 'border-transparent text-zinc-400 hover:border-zinc-800 hover:bg-zinc-900/60 hover:text-zinc-100'
                            : 'text-zinc-400 hover:text-zinc-100'
                )}
            >
                <item.icon className={cn('shrink-0', mobile ? 'h-[18px] w-[18px]' : 'h-4 w-4', active && 'text-teal-400')} />
                <span>{mobile ? item.name : item.label}</span>
            </Link>
        );
    };

    return (
        <div className="min-h-screen bg-zinc-950 font-sans text-zinc-100 selection:bg-teal-500/30">
            <div className="bg-noise" />

            <nav className="fixed inset-x-0 top-0 z-[60] border-b border-white/[0.08] bg-zinc-950" aria-label="Primary navigation">
                <div className="mx-auto flex h-16 max-w-[1440px] items-center px-4 lg:px-6">
                    <Link href="/dashboard" className="mr-5 flex min-w-0 shrink-0 items-center gap-3" aria-label="Time and Attendance dashboard">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-teal-400/25 bg-teal-400/10 text-teal-300">
                            <Clock className="h-[18px] w-[18px]" strokeWidth={2} />
                        </div>
                        <div className="hidden min-w-0 sm:block">
                            <div className="whitespace-nowrap text-sm font-semibold leading-5 text-zinc-100">Time &amp; Attendance</div>
                            <div className="text-[11px] leading-4 text-zinc-500">Seemplify</div>
                        </div>
                    </Link>

                    <div className="hidden h-16 min-w-0 flex-1 items-center min-[1180px]:flex">
                        {desktopNavigation.map(item => renderNavigationLink(item))}
                    </div>

                    <div className="ml-auto flex shrink-0 items-center gap-2">
                        <div className="relative hidden md:block">
                            <button
                                type="button"
                                onClick={toggleOrganizationMenu}
                                aria-expanded={orgMenuOpen}
                                aria-haspopup="menu"
                                className={cn(
                                    'flex h-9 max-w-[190px] items-center gap-2 rounded-lg border px-3 text-sm transition-colors',
                                    orgMenuOpen
                                        ? 'border-zinc-600 bg-zinc-800 text-white'
                                        : 'border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900'
                                )}
                            >
                                <Building2 className="h-4 w-4 shrink-0 text-teal-400" />
                                <span className="truncate">{user?.currentOrganization?.name || 'Organization'}</span>
                                <ChevronDown className={cn('h-4 w-4 shrink-0 text-zinc-500 transition-transform', orgMenuOpen && 'rotate-180')} />
                            </button>

                            {orgMenuOpen && (
                                <>
                                    <button className="fixed inset-0 z-40 cursor-default" aria-label="Close organization menu" onClick={() => setOrgMenuOpen(false)} />
                                    <div className="absolute right-0 top-11 z-50 w-72 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-lg shadow-black/30" role="menu">
                                        <div className="border-b border-zinc-800 px-3 py-2.5 text-xs font-medium text-zinc-500">Switch organization</div>
                                        <div className="max-h-72 overflow-y-auto p-1">
                                            {user?.organizations?.map(org => {
                                                const selected = org.id === user?.currentOrganization?.id;
                                                return (
                                                    <button
                                                        key={org.id}
                                                        type="button"
                                                        role="menuitem"
                                                        onClick={() => selectOrganization(org.id)}
                                                        className={cn(
                                                            'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
                                                            selected ? 'bg-zinc-900 text-white' : 'text-zinc-300 hover:bg-zinc-900/70'
                                                        )}
                                                    >
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block truncate text-sm font-medium">{org.name}</span>
                                                            <span className="block text-xs capitalize text-zinc-500">{org.role.replace('_', ' ')}</span>
                                                        </span>
                                                        {selected && <Check className="h-4 w-4 shrink-0 text-teal-400" />}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="relative">
                            <button
                                type="button"
                                onClick={toggleUserMenu}
                                aria-expanded={userMenuOpen}
                                aria-haspopup="menu"
                                aria-label="Open account menu"
                                className={cn(
                                    'flex h-9 items-center gap-2 rounded-lg border p-1 pr-2 transition-colors',
                                    userMenuOpen
                                        ? 'border-zinc-600 bg-zinc-800'
                                        : 'border-transparent hover:border-zinc-800 hover:bg-zinc-900'
                                )}
                            >
                                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-500 text-xs font-semibold text-zinc-950">
                                    {user?.name?.charAt(0)?.toUpperCase() || 'U'}
                                </span>
                                <ChevronDown className={cn('hidden h-4 w-4 text-zinc-500 sm:block transition-transform', userMenuOpen && 'rotate-180')} />
                            </button>

                            {userMenuOpen && (
                                <>
                                    <button className="fixed inset-0 z-40 cursor-default" aria-label="Close account menu" onClick={() => setUserMenuOpen(false)} />
                                    <div className="absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-lg shadow-black/30" role="menu">
                                        <div className="border-b border-zinc-800 px-4 py-3">
                                            <div className="truncate text-sm font-medium text-white">{user?.name}</div>
                                            <div className="mt-0.5 truncate text-xs text-zinc-500">{user?.email}</div>
                                        </div>
                                        <div className="p-1">
                                            <button
                                                type="button"
                                                onClick={logout}
                                                role="menuitem"
                                                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
                                            >
                                                <LogOut className="h-4 w-4 text-zinc-500" />
                                                Sign out
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        <button
                            type="button"
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-white min-[1180px]:hidden"
                            onClick={() => {
                                setMobileOpen(true);
                                setOrgMenuOpen(false);
                                setUserMenuOpen(false);
                            }}
                            aria-label="Open navigation"
                        >
                            <Menu className="h-5 w-5" />
                        </button>
                    </div>
                </div>
            </nav>

            <main className="mx-auto max-w-7xl px-4 pb-10 pt-20 lg:px-8">
                {children}
            </main>

            {mobileOpen && (
                <div className="fixed inset-0 z-[70] min-[1180px]:hidden">
                    <button className="absolute inset-0 bg-black/70" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
                    <div className="absolute inset-x-0 top-0 max-h-screen overflow-y-auto border-b border-zinc-800 bg-zinc-950 shadow-lg shadow-black/30">
                        <div className="mx-auto max-w-3xl px-4 pb-6">
                            <div className="flex h-16 items-center justify-between border-b border-zinc-800">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-teal-400/25 bg-teal-400/10 text-teal-300">
                                        <Clock className="h-[18px] w-[18px]" />
                                    </div>
                                    <div>
                                        <div className="text-sm font-semibold text-white">Time &amp; Attendance</div>
                                        <div className="text-xs text-zinc-500">Navigation</div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setMobileOpen(false)}
                                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-white"
                                    aria-label="Close navigation"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="py-5">
                                <div className="mb-2 text-xs font-medium text-zinc-500">Personal</div>
                                <div className="grid gap-1 sm:grid-cols-2">
                                    {personalNavigation.map(item => renderNavigationLink(item, true))}
                                </div>
                            </div>

                            {showManagement && (
                                <div className="border-t border-zinc-800 py-5">
                                    <div className="mb-2 text-xs font-medium text-zinc-500">Management</div>
                                    <div className="grid gap-1 sm:grid-cols-2">
                                        {managementNavigation.map(item => renderNavigationLink(item, true))}
                                    </div>
                                </div>
                            )}

                            <div className="border-t border-zinc-800 pt-5 md:hidden">
                                <div className="mb-2 text-xs font-medium text-zinc-500">Organization</div>
                                <div className="grid gap-1 sm:grid-cols-2">
                                    {user?.organizations?.map(org => {
                                        const selected = org.id === user?.currentOrganization?.id;
                                        return (
                                            <button
                                                key={org.id}
                                                type="button"
                                                onClick={() => selectOrganization(org.id)}
                                                className={cn(
                                                    'flex min-h-12 items-center gap-3 border px-3 text-left',
                                                    selected ? 'border-zinc-700 bg-zinc-900' : 'border-transparent hover:border-zinc-800 hover:bg-zinc-900/60'
                                                )}
                                            >
                                                <Building2 className={cn('h-[18px] w-[18px]', selected ? 'text-teal-400' : 'text-zinc-500')} />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm font-medium text-zinc-200">{org.name}</span>
                                                    <span className="block text-xs capitalize text-zinc-500">{org.role.replace('_', ' ')}</span>
                                                </span>
                                                {selected && <Check className="h-4 w-4 text-teal-400" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="mt-5 flex items-center justify-between border-t border-zinc-800 pt-5">
                                <div className="min-w-0 pr-4">
                                    <div className="truncate text-sm font-medium text-zinc-200">{user?.name}</div>
                                    <div className="truncate text-xs text-zinc-500">{user?.email}</div>
                                </div>
                                <button
                                    type="button"
                                    onClick={logout}
                                    className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-zinc-800 px-3 text-sm text-zinc-300 hover:bg-zinc-900 hover:text-white"
                                >
                                    <LogOut className="h-4 w-4" />
                                    Sign out
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
