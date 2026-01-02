'use client';

import Link from "next/link";
import { cn } from "@/lib/utils";
import SeemplifyLogo from "@/components/SeemplifyLogo";

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showText?: boolean;
}

export const Logo = ({ size = 'md', className, showText = true }: LogoProps) => {
  const textSizes = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-xl',
  };

  return (
    <Link href="/dashboard" className={cn("flex items-center gap-2.5", className)}>
      <SeemplifyLogo size={size} />
      {showText && (
        <div className="flex items-baseline">
          <span className={cn("font-semibold tracking-tight text-foreground", textSizes[size])}>
            Seemplify
          </span>
          <span className={cn("ml-1.5 font-light text-blue-400", textSizes[size])}>
            Recruiter
          </span>
        </div>
      )}
    </Link>
  );
};

export default Logo;
