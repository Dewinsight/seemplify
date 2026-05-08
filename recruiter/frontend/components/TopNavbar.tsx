"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Users,
  Briefcase,
  Calendar,
  Bot,
  Settings,
  Menu,
  LogOut,
  User,
  Sun,
  Moon,
  Shield,
  GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useTheme } from "next-themes";
import { getAvailableThemeOptions } from "@/utils/themeConfig";
import { useUser } from "@/context/UserContext";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
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

const navigationItems = [
  { title: "Dashboard", href: "/dashboard", icon: Home },
  { title: "Candidates", href: "/candidates", icon: Users },
  { title: "Jobs", href: "/jobs", icon: Briefcase },
  { title: "AI Interviews", href: "/ai-interviews", icon: Bot },
  { title: "Calendar", href: "/calendar", icon: Calendar },
];

// Directly use the Settings component for the icon
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

const NavLink = ({ item, isMobile = false, onClick, pathname }: NavLinkProps) => (
  <Link
    href={item.href}
    onClick={onClick}
    className={cn(
      "flex items-center gap-2 transition-colors duration-200 ease-in-out",
      isMobile
        ? "text-lg font-medium p-3 rounded-lg"
        : "text-sm font-medium px-3 py-2 rounded-md",
      pathname?.startsWith(item.href)
        ? "bg-primary/10 text-primary"
        : "text-foreground/70 hover:text-foreground hover:bg-accent"
    )}
  >
    <item.icon className="h-5 w-5" />
    <span>{item.title}</span>
  </Link>
);

const TopNavbar = () => {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { state, getUserDisplayName, getUserAvatar } = useUser();
  const { logout } = useAuth();
  const { user } = state;
  const { currentOrganization } = useOrganization();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  
  // Get available theme options from environment configuration
  const availableThemes = getAvailableThemeOptions();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60" data-tutorial="app-navbar">
      <div className="container flex h-20 items-center justify-between max-w-screen-2xl">
        {/* Left Section - Logo and Mobile Menu */}
        <div className="flex items-center gap-4">
          <div className="md:hidden">
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-6 w-6" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[300px] sm:w-[340px]">
                <SheetHeader className="mb-8">
                  <SheetTitle>
                    <Logo size="sm" />
                  </SheetTitle>
                </SheetHeader>
                <nav className="flex flex-col gap-4">
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
              </SheetContent>
            </Sheet>
          </div>
          <div className="hidden md:block">
            <Logo size="sm" />
          </div>
        </div>

        {/* Center Section - Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-2">
          {navigationItems.map((item) => (
            <NavLink key={item.title} item={item} pathname={pathname} />
          ))}
        </nav>

        {/* Right Section - Actions */}
        <div className="flex items-center gap-4">
          <div className="w-full flex-1 md:w-auto md:flex-none">
            {currentOrganization && <OrganizationSwitcher showCreateOption={true} />}
          </div>
          <NotificationDropdown />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                <Avatar className="h-10 w-10 border-2 border-transparent group-hover:border-primary transition-colors">
                  <AvatarImage src={getUserAvatar() || undefined} alt={getUserDisplayName()} />
                  <AvatarFallback>{user?.profile?.firstName?.[0] || 'U'}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={settingsNavigation.href}>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>{settingsNavigation.title}</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                  <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                  <span className="ml-2">Toggle Theme</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    {availableThemes.map((themeOption) => (
                      <DropdownMenuItem 
                        key={themeOption.value}
                        onClick={() => setTheme(themeOption.value)}
                      >
                        {themeOption.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              {user?.email === 'michael.egbo@aiinnigeria.com' && (
                <>
                  <DropdownMenuItem asChild>
                    <Link href="/admin/dashboard" target="_blank">
                      <Shield className="mr-2 h-4 w-4" />
                      <span>Admin Portal</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => logout()}>
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
