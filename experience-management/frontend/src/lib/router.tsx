import { forwardRef, type AnchorHTMLAttributes, type MouseEvent, useEffect } from 'react';
import { useLocation as useWouterLocation, useParams as useWouterParams } from 'wouter';
import { cn } from '@/lib/utils';

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(({ to, onClick, ...props }, ref) => {
  const [, navigate] = useWouterLocation();
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event); if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target === '_blank') return;
    event.preventDefault(); navigate(to);
  }
  return <a ref={ref} href={to} onClick={follow} {...props} />;
});
Link.displayName = 'Link';

type NavLinkProps = Omit<LinkProps, 'className'> & { end?: boolean; className?: string | ((state: { isActive: boolean }) => string) };
export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(({ to, end, className, ...props }, ref) => {
  const [location] = useWouterLocation(); const isActive = end ? location === to : location === to || location.startsWith(`${to}/`);
  return <Link ref={ref} to={to} className={cn(typeof className === 'function' ? className({ isActive }) : className)} {...props} />;
});
NavLink.displayName = 'NavLink';
export function useNavigate() { const [, navigate] = useWouterLocation(); return navigate; }
export function useLocation() { const [pathname] = useWouterLocation(); return { pathname }; }
export function useParams<T extends Record<string, string>>() { return useWouterParams<T>(); }
export function Navigate({ to }: { to: string }) { const navigate = useNavigate(); useEffect(() => navigate(to, { replace: true }), [navigate, to]); return null; }
export function PageLoader() { return <div className="min-h-screen animate-pulse bg-muted" />; }
