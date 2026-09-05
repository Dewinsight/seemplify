"use client";

import { useMemo, useState } from "react";
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
  LayoutGrid,
  User,
  Shield,
  GraduationCap,
  FileSignature,
  FileText,
  PlusCircle,
  ClipboardList,
  ChevronDown,
  ListChecks,
  ListTodo,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { exitRecruiterToHub } from "@/utils/productExit";
import { useUser } from "@/context/UserContext";
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
import { OpenAILogo } from "@/components/ui/openai-logo";
import { useFeatureFlags } from "@/context/FeatureFlagsContext";
import type { PlatformFeatureKey } from "@/lib/platformFeatures";
import { useBrandConfig } from "@/context/BrandContext";

type NavigationLink = {
  title: string;
  href: string;
  icon: React.ElementType;
  feature?: PlatformFeatureKey;
};

type NavigationGroup = {
  title: string;
  icon: React.ElementType;
  children: NavigationLink[];
  feature?: PlatformFeatureKey;
};

type NavigationItem = NavigationLink | NavigationGroup;

const recruiterNavigationItems: NavigationItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: Home },
  {
    title: "Recruitment",
    icon: Users,
    children: [
      { title: "Candidates", href: "/candidates", icon: Users },
      { title: "Jobs", href: "/jobs", icon: Briefcase },
      { title: "CV Processing", href: "/cv-processing", icon: ListChecks },
      { title: "AI Interviews", href: "/ai-interviews", icon: Bot, feature: "aiInterviews" },
    ],
  },
  { title: "Calendar", href: "/calendar", icon: Calendar },
];

const peopleTransitionsNavigationItems: NavigationItem[] = [
  { title: "Dashboard", href: "/people-transitions", icon: Home, feature: "peopleTransitions" },
  {
    title: "Processes",
    icon: GraduationCap,
    feature: "peopleTransitions",
    children: [
      { title: "Start Process", href: "/people-transitions/new", icon: PlusCircle },
      { title: "Segments", href: "/people-transitions/segments", icon: ListChecks },
      { title: "Tasks", href: "/people-transitions/tasks", icon: ListTodo },
    ],
  },
  {
    title: "Documents & Signing",
    icon: FileSignature,
    feature: "peopleTransitions",
    children: [
      { title: "Documents", href: "/people-transitions/documents", icon: FileText },
      { title: "Templates", href: "/people-transitions/templates", icon: ClipboardList },
      { title: "My Documents", href: "/my-documents", icon: FileSignature },
    ],
  },
  { title: "Analytics", href: "/people-transitions/analytics", icon: BarChart3, feature: "peopleTransitions" },
];

// Directly use the Settings component for the icon
const settingsNavigation: NavigationLink = { title: "Settings", href: "/settings", icon: Settings };

function isNavigationGroup(item: NavigationItem): item is NavigationGroup {
  return "children" in item;
}

function isLinkActive(pathname: string | null, href: string) {
  return pathname === href || Boolean(pathname?.startsWith(`${href}/`));
}

function isGroupActive(pathname: string | null, item: NavigationGroup) {
  return item.children.some((child) => isLinkActive(pathname, child.href));
}

const PeopleTransitionsLockup = () => (
  <Link href="/people-transitions" className="people-transitions-lockup" aria-label="Seemplify People Transitions">
    <img src="/seemplify-wordmark.svg" alt="Seemplify" className="people-transitions-lockup__wordmark" />
    <span className="people-transitions-lockup__product">People Transitions</span>
  </Link>
);

interface NavLinkProps {
  item: NavigationLink;
  pathname: string | null;
  isMobile?: boolean;
  onClick?: () => void;
}

const NavLink = ({ item, isMobile = false, onClick, pathname }: NavLinkProps) => (
  <Link
    href={item.href}
    onClick={onClick}
    className={cn(
      "recruiter-nav-item",
      isMobile ? "recruiter-nav-item--mobile" : "recruiter-nav-item--desktop",
      isLinkActive(pathname, item.href) && "is-active"
    )}
  >
    <item.icon className="recruiter-nav-item__icon h-5 w-5" />
    <span>{item.title}</span>
  </Link>
);

interface NavDropdownProps {
  item: NavigationGroup;
  pathname: string | null;
  isMobile?: boolean;
  onItemClick?: () => void;
}

const NavDropdown = ({ item, pathname, isMobile = false, onItemClick }: NavDropdownProps) => {
  const active = isGroupActive(pathname, item);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            "recruiter-nav-item btn-sm",
            isMobile ? "recruiter-nav-item--mobile" : "recruiter-nav-item--desktop",
            active && "is-active"
          )}
        >
          <item.icon className="recruiter-nav-item__icon h-5 w-5" />
          <span>{item.title}</span>
          <ChevronDown className="recruiter-nav-item__chevron ml-auto h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={isMobile ? "start" : "center"} className="w-52">
        {item.children.map((child) => (
          <DropdownMenuItem key={child.href} asChild>
            <Link href={child.href} onClick={onItemClick} className="flex items-center gap-2">
              <child.icon className="h-4 w-4" />
              <span>{child.title}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const TopNavbar = () => {
  const pathname = usePathname();
  const { state, getUserDisplayName, getUserAvatar } = useUser();
  const { user } = state;
  const { currentOrganization } = useOrganization();
  const brand = useBrandConfig();
  const { isFeatureEnabled } = useFeatureFlags();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const isPeopleTransitionsWorkspace = Boolean(
    pathname?.startsWith("/people-transitions") ||
    pathname?.startsWith("/my-documents") ||
    pathname?.startsWith("/onboarding")
  );
  const navigationItems = isPeopleTransitionsWorkspace
    ? peopleTransitionsNavigationItems
    : recruiterNavigationItems;
  const visibleNavigationItems = useMemo<NavigationItem[]>(() =>
    navigationItems.reduce<NavigationItem[]>((items, item) => {
      if (item.feature && !isFeatureEnabled(item.feature)) {
        return items;
      }

      if (isNavigationGroup(item)) {
        const children = item.children.filter(
          (child) => !child.feature || isFeatureEnabled(child.feature)
        );
        if (children.length > 0) {
          items.push({ ...item, children });
        }
        return items;
      }

      items.push(item);
      return items;
    }, []),
  [isFeatureEnabled, navigationItems]);
  
  return (
    <header
      className={cn("recruiter-topbar", isPeopleTransitionsWorkspace && "recruiter-topbar--people-transitions")}
      data-tutorial="app-navbar"
      data-workspace={isPeopleTransitionsWorkspace ? "people-transitions" : "recruiter"}
    >
      <div className="recruiter-topbar__inner">
        {/* Left Section - Logo and Mobile Menu */}
        <div className="recruiter-topbar__brand">
          <div className="xl:hidden">
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="recruiter-topbar__menu-trigger btn-sm">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[300px] sm:w-[340px]">
                <SheetHeader className="mb-8">
                  <SheetTitle>
                    {isPeopleTransitionsWorkspace && brand.id === "smarthr" ? <PeopleTransitionsLockup /> : <Logo size="sm" />}
                  </SheetTitle>
                </SheetHeader>
                <nav className="flex flex-col gap-4">
                  {[...visibleNavigationItems, settingsNavigation].map((item) => (
                    isNavigationGroup(item) ? (
                      <NavDropdown
                        key={item.title}
                        item={item}
                        isMobile={true}
                        onItemClick={() => setIsSheetOpen(false)}
                        pathname={pathname}
                      />
                    ) : (
                      <NavLink
                        key={item.title}
                        item={item}
                        isMobile={true}
                        onClick={() => setIsSheetOpen(false)}
                        pathname={pathname}
                      />
                    )
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
          <div className="recruiter-topbar__logo-wrap">
            {isPeopleTransitionsWorkspace && brand.id === "smarthr" ? (
              <PeopleTransitionsLockup />
            ) : (
              <>
                <Logo size="sm" className="recruiter-topbar__logo" />
                {isPeopleTransitionsWorkspace && (
                  <span className="hidden border-l border-border pl-3 text-sm font-semibold text-foreground sm:inline">
                    People Transitions
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Center Section - Desktop Navigation */}
        <nav className="recruiter-topbar__desktop-nav">
          {visibleNavigationItems.map((item) => (
            isNavigationGroup(item) ? (
              <NavDropdown key={item.title} item={item} pathname={pathname} />
            ) : (
              <NavLink key={item.title} item={item} pathname={pathname} />
            )
          ))}
        </nav>

        {/* Right Section - Actions */}
        <div className="recruiter-topbar__actions">
          <div className="recruiter-topbar__organization">
            {currentOrganization && (
              <OrganizationSwitcher
                className="recruiter-nav__org-trigger btn-sm"
                showCreateOption={true}
              />
            )}
          </div>
          {/* Direct route to the ChatGPT connection: the AI runs on the
              signed-in person's own account, so it needs a standing entry
              point rather than only appearing when something blocks. */}
          <Button
            asChild
            variant="outline"
            size="sm"
            className="recruiter-nav__chatgpt btn-sm"
            data-testid="nav-connect-chatgpt"
          >
            <Link href="/settings/ai-account">
              <OpenAILogo className="h-4 w-4" />
              <span>ChatGPT</span>
            </Link>
          </Button>
          <div className="recruiter-topbar__notifications">
            <NotificationDropdown />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="recruiter-nav__profile-trigger btn-sm group"
                aria-label={`Open profile menu for ${getUserDisplayName()}`}
              >
                <Avatar className="recruiter-nav__profile-avatar">
                  <AvatarImage src={getUserAvatar() || undefined} alt={getUserDisplayName()} />
                  <AvatarFallback>{user?.profile?.firstName?.[0] || 'U'}</AvatarFallback>
                </Avatar>
                <span className="recruiter-nav__profile-copy">
                  <span className="recruiter-nav__profile-name">{getUserDisplayName()}</span>
                  <span className="recruiter-nav__profile-context">
                    {currentOrganization?.name || user?.email || 'Account'}
                  </span>
                </span>
                <ChevronDown className="recruiter-nav__profile-chevron h-4 w-4" />
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
              <DropdownMenuItem asChild>
                <a href={process.env.NEXT_PUBLIC_IDP_URL || "https://auth.seemplifyai.com"} onClick={(event) => { event.preventDefault(); void exitRecruiterToHub(process.env.NEXT_PUBLIC_IDP_URL || "https://auth.seemplifyai.com"); }}>
                  <LayoutGrid className="mr-2 h-4 w-4" />
                  <span>Back to App Hub</span>
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};

export default TopNavbar;
