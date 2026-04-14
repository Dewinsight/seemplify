'use client';

import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useBrandConfig } from "@/context/BrandContext";

interface DynamicLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showPulse?: boolean;
  linkTo?: string;
}

export const DynamicLogo = ({ 
  size = 'md', 
  className, 
  showPulse = true,
  linkTo = '/dashboard' 
}: DynamicLogoProps) => {
  const brand = useBrandConfig();

  const sizeClasses = {
    sm: {
      container: "w-8 h-8",
      imgSize: 32,
      text: "text-xs",
      pulse: "w-2.5 h-2.5",
      nameText: "text-lg",
    },
    md: {
      container: "w-10 h-10",
      imgSize: 40,
      text: "text-sm",
      pulse: "w-3 h-3",
      nameText: "text-xl",
    },
    lg: {
      container: "w-12 h-12",
      imgSize: 48,
      text: "text-base",
      pulse: "w-3.5 h-3.5",
      nameText: "text-2xl",
    },
  };

  const selectedSize = sizeClasses[size];

  const LogoContent = () => (
    <div className="flex items-center gap-3">
      <div className="relative">
        {brand.useImageLogo && brand.logo ? (
          <Image
            src={brand.logo}
            alt={brand.name}
            width={selectedSize.imgSize}
            height={selectedSize.imgSize}
            className={cn("rounded-xl object-contain", selectedSize.container)}
          />
        ) : (
          <div
            className={cn(
              `bg-gradient-to-br ${brand.gradient} rounded-xl flex items-center justify-center shadow-xl transition-all duration-300`,
              selectedSize.container
            )}
          >
            <span className={cn("font-extrabold text-white tracking-tighter font-heading", selectedSize.text)}>
              {brand.shortName}
            </span>
          </div>
        )}
        {showPulse && !brand.useImageLogo && (
          <div
            className={cn(
              `absolute -top-1 -right-1 ${brand.colors.pulse} rounded-full border-2 border-slate-900 animate-pulse`,
              selectedSize.pulse
            )}
          ></div>
        )}
      </div>
      <div>
        <span className={cn("font-heading font-bold text-white", selectedSize.nameText)}>
          {brand.name}
        </span>
        {size === 'lg' && (
          <p className="text-slate-300 text-xs font-medium">{brand.tagline}</p>
        )}
      </div>
    </div>
  );

  if (linkTo) {
    return (
      <Link href={linkTo} className={cn("flex items-center", className)}>
        <LogoContent />
      </Link>
    );
  }

  return (
    <div className={cn("flex items-center", className)}>
      <LogoContent />
    </div>
  );
};

export const DynamicLogoIcon = ({ 
  size = 'md',
  showPulse = true,
  className
}: Omit<DynamicLogoProps, 'linkTo'>) => {
  const brand = useBrandConfig();

  const sizeClasses = {
    sm: { container: "w-8 h-8", imgSize: 32, text: "text-xs", pulse: "w-2.5 h-2.5" },
    md: { container: "w-10 h-10", imgSize: 40, text: "text-sm", pulse: "w-3 h-3" },
    lg: { container: "w-12 h-12", imgSize: 48, text: "text-base", pulse: "w-3.5 h-3.5" },
  };

  const selectedSize = sizeClasses[size];

  if (brand.useImageLogo && brand.logo) {
    return (
      <div className={cn("relative", className)}>
        <Image
          src={brand.logo}
          alt={brand.name}
          width={selectedSize.imgSize}
          height={selectedSize.imgSize}
          className={cn("rounded-xl object-contain", selectedSize.container)}
        />
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          `bg-gradient-to-br ${brand.gradient} rounded-xl flex items-center justify-center shadow-xl transition-all duration-300`,
          selectedSize.container
        )}
      >
        <span className={cn("font-extrabold text-white tracking-tighter font-heading", selectedSize.text)}>
          {brand.shortName}
        </span>
      </div>
      {showPulse && (
        <div
          className={cn(
            `absolute -top-1 -right-1 ${brand.colors.pulse} rounded-full border-2 border-slate-900 animate-pulse`,
            selectedSize.pulse
          )}
        ></div>
      )}
    </div>
  );
};

export default DynamicLogo;
