"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Users,
  Briefcase,
  Calendar,
  Settings,
  Menu,
  MessageSquare,
  LogOut,
  User,
  Shield,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useTheme } from "next-themes";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useUser } from "@/context/UserContext";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import OrganizationSwitcher from "@/components/OrganizationSwitcher";
import { Logo } from "@/components/ui/Logo";
import NotificationDropdown from "@/components/NotificationDropdown";
import SeemplifyLogo from "@/components/SeemplifyLogo";

const navigationItems = [
  { title: "Dashboard", href: "/dashboard", icon: Home },
  { title: "Candidates", href: "/candidates", icon: Users },
  { title: "Jobs", href: "/jobs", icon: Briefcase },
  { title: "Calendar", href: "/calendar", icon: Calendar },
  { title: "AI Assistant", href: "/assistant", icon: MessageSquare },
];

const settingsNavigation = { title: "Settings", href: "/settings", icon: Settings };

interface NavLinkProps {
  item: {
    title: string;
    href: string;
    icon: React.ElementType;
  };
  pathname: string;
  isMobile?: boolean;
  onClick?: () => void;
}

const NavLink = ({ item, isMobile = false, onClick, pathname }: NavLinkProps) => {
  const isActive = pathname?.startsWith(item.href);

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 transition-all duration-300 relative group",
        isMobile
          ? "text-base font-medium p-3 rounded-xl"
          : "text-sm font-medium px-3 py-2 rounded-lg",
        isActive
          ? isMobile
            ? "bg-primary/10 text-primary shadow-lg"
            : "text-foreground bg-primary/10 shadow-lg shadow-primary/5 backdrop-blur-md border border-primary/10"
          : isMobile
            ? "text-muted-foreground hover:text-foreground hover:bg-muted"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      )}
    >
      <item.icon className={cn("h-4 w-4 transition-colors", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
      <span>{item.title}</span>
      {isActive && !isMobile && (
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.6)]" />
      )}
    </Link>
  );
};

const TopNavbar = () => {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { state, getUserDisplayName, getUserAvatar } = useUser();
  const { logout } = useAuth();
  const { user } = state;
  const { currentOrganization } = useOrganization();
  const [isSheetOpen, setIsSheetOpen] = useState(false);



  return (
    <header
      className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/60 dark:bg-background/40 dark:supports-[backdrop-filter]:bg-background/30"
      data-tutorial="app-navbar"
    >
      <div className="container flex h-16 items-center justify-between max-w-screen-2xl px-4 lg:px-6">
        {/* Left Section - Logo and Mobile Menu */}
        <div className="flex items-center gap-4">
          {/* Mobile Menu Button */}
          <div className="lg:hidden">
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-[300px] bg-background border-border p-0"
              >
                <div className="flex flex-col h-full">
                  <SheetHeader className="p-6 border-b border-border">
                    <SheetTitle className="flex items-center gap-2.5">
                      <SeemplifyLogo size="md" />
                      <div className="flex items-baseline">
                        <span className="font-semibold tracking-tight text-foreground">Seemplify</span>
                        <span className="ml-1.5 font-light text-primary">Recruiter</span>
                      </div>
                    </SheetTitle>
                  </SheetHeader>

                  <nav className="flex-1 p-4 space-y-1">
                    {[...navigationItems, settingsNavigation].map((item) => (
                      <NavLink
                        key={item.title}
                        item={item}
                        isMobile={true}
                        onClick={() => setIsSheetOpen(false)}
                        pathname={pathname}
                      />
                    ))}
                  </nav>

                  <div className="p-4 border-t border-border">
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50">
                      <Avatar className="h-10 w-10 border border-border">
                        <AvatarImage src={getUserAvatar() || undefined} alt={getUserDisplayName()} />
                        <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-500 text-white">
                          {user?.profile?.firstName?.[0] || 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{getUserDisplayName()}</p>
                        <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>

          {/* Desktop Logo */}
          <div className="hidden lg:block">
            <Logo size="sm" />
          </div>
        </div>

        {/* Center Section - Desktop Navigation */}
        <nav className="hidden lg:flex items-center gap-1">
          {navigationItems.map((item) => (
            <div key={item.title} className="relative">
              <NavLink item={item} pathname={pathname} />
            </div>
          ))}
        </nav>

        {/* Right Section - Actions */}
        <div className="flex items-center gap-3">
          {/* Organization Switcher */}
          <div className="hidden sm:block">
            {currentOrganization && <OrganizationSwitcher showCreateOption={true} />}
          </div>

          <ThemeToggle />

          {/* Notifications */}
          <NotificationDropdown />

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
                <Avatar className="h-9 w-9 border border-border/50 transition-all hover:border-primary/50">
                  <AvatarImage src={getUserAvatar() || undefined} alt={getUserDisplayName()} />
                  <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-500 text-white text-sm">
                    {user?.profile?.firstName?.[0] || 'U'}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-56 glass-card border-border/20 text-foreground bg-popover/90 dark:bg-popover/80"
              align="end"
              forceMount
            >
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">{getUserDisplayName()}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings" className="cursor-pointer">
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={settingsNavigation.href} className="cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  <span>{settingsNavigation.title}</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {user?.email === 'michael.egbo@aiinnigeria.com' && (
                <>
                  <DropdownMenuItem asChild>
                    <Link href="/admin/dashboard" target="_blank" className="cursor-pointer">
                      <Shield className="mr-2 h-4 w-4" />
                      <span>Admin Portal</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onClick={() => logout()}
                className="text-destructive focus:text-destructive cursor-pointer"
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

export default TopNavbar;
