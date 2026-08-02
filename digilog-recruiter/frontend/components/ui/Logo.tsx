'use client';

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useBrandConfig } from "@/context/BrandContext";

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const Logo = ({ size = 'md', className }: LogoProps) => {
  const brand = useBrandConfig();

  const sizeClasses = {
    sm: {
      container: "w-8 h-8",
      icon: "w-4 h-4",
      pulse: "w-2.5 h-2.5",
      text: "text-lg",
    },
    md: {
      container: "w-10 h-10",
      icon: "w-5 h-5",
      pulse: "w-3 h-3",
      text: "text-xl",
    },
    lg: {
      container: "w-12 h-12",
      icon: "w-6 h-6",
      pulse: "w-3.5 h-3.5",
      text: "text-2xl",
    },
  };

  const selectedSize = sizeClasses[size];

  return (
    <Link href="/dashboard" className={cn("flex items-center space-x-2", className)}>
      <div className="relative">
        {brand.iconLogo ? (
          <div
            className={cn(
              "rounded-xl bg-white flex items-center justify-center shadow-sm ring-1 ring-black/5 p-1.5 transition-all duration-300",
              selectedSize.container
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.iconLogo} alt={brand.name} className="w-full h-full object-contain" />
          </div>
        ) : (
          <div
            className={cn(
              `bg-gradient-to-br ${brand.gradient} rounded-lg flex items-center justify-center shadow-lg transition-all duration-300`,
              selectedSize.container
            )}
          >
            <div className="flex items-center justify-center font-extrabold text-white">
              <span className={cn("tracking-tighter font-heading", selectedSize.icon === "w-4 h-4" ? "text-xs" : selectedSize.icon === "w-5 h-5" ? "text-sm" : "text-base")}>
                {brand.shortName}
              </span>
            </div>
          </div>
        )}
        <div
          className={cn(
            `absolute -top-1 -right-1 ${brand.colors.pulse} rounded-full border-2 border-background animate-pulse`,
            selectedSize.pulse
          )}
        ></div>
      </div>
      <span className={cn("font-heading font-bold", selectedSize.text)}>{brand.name}</span>
    </Link>
  );
};

export default Logo;