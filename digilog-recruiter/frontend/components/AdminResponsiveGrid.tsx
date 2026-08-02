"use client";

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface AdminResponsiveGridProps {
  children: ReactNode;
  columns?: {
    sm?: number;  // Default: 1
    md?: number;  // Default: 2
    lg?: number;  // Default: 3
    xl?: number;  // Default: 4
  };
  gap?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
}

export default function AdminResponsiveGrid({
  children,
  columns = {
    sm: 1,
    md: 2,
    lg: 3,
    xl: 4
  },
  gap = 'md',
  className,
}: AdminResponsiveGridProps) {
  // Define gap classes
  const gapClasses = {
    none: 'gap-0',
    sm: 'gap-2 sm:gap-3',
    md: 'gap-3 sm:gap-4',
    lg: 'gap-4 sm:gap-6',
  };

  // Define grid column classes
  const gridColumnsClasses = [
    // sm columns (smallest screens)
    columns.sm === 1 ? 'grid-cols-1' : 
    columns.sm === 2 ? 'grid-cols-2' : 
    columns.sm === 3 ? 'grid-cols-3' : 
    columns.sm === 4 ? 'grid-cols-4' : 'grid-cols-1',
    
    // md columns (tablets)
    columns.md === 1 ? 'sm:grid-cols-1' : 
    columns.md === 2 ? 'sm:grid-cols-2' : 
    columns.md === 3 ? 'sm:grid-cols-3' : 
    columns.md === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-2',
    
    // lg columns (small desktops)
    columns.lg === 1 ? 'md:grid-cols-1' : 
    columns.lg === 2 ? 'md:grid-cols-2' : 
    columns.lg === 3 ? 'md:grid-cols-3' : 
    columns.lg === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3',
    
    // xl columns (large desktops)
    columns.xl === 1 ? 'lg:grid-cols-1' : 
    columns.xl === 2 ? 'lg:grid-cols-2' : 
    columns.xl === 3 ? 'lg:grid-cols-3' : 
    columns.xl === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-4',
  ];
  
  const gridClasses = cn(
    'grid',
    gridColumnsClasses,
    gapClasses[gap],
    className
  );
  
  return (
    <div className={gridClasses}>
      {children}
    </div>
  );
}

// Card component designed to work with AdminResponsiveGrid
interface AdminResponsiveCardProps {
  children: ReactNode;
  className?: string;
  colSpan?: {
    sm?: 1 | 2 | 3 | 4; // Default: 1
    md?: 1 | 2 | 3 | 4; // Default: 1
    lg?: 1 | 2 | 3 | 4; // Default: 1
    xl?: 1 | 2 | 3 | 4; // Default: 1
  };
}

export function AdminResponsiveCard({
  children,
  className,
  colSpan = {},
}: AdminResponsiveCardProps) {
  // Define column span classes
  const colSpanClasses = [
    // sm col span (smallest screens)
    colSpan.sm === 2 ? 'col-span-2' : 
    colSpan.sm === 3 ? 'col-span-3' : 
    colSpan.sm === 4 ? 'col-span-4' : '',
    
    // md col span (tablets)
    colSpan.md === 2 ? 'sm:col-span-2' : 
    colSpan.md === 3 ? 'sm:col-span-3' : 
    colSpan.md === 4 ? 'sm:col-span-4' : '',
    
    // lg col span (small desktops)
    colSpan.lg === 2 ? 'md:col-span-2' : 
    colSpan.lg === 3 ? 'md:col-span-3' : 
    colSpan.lg === 4 ? 'md:col-span-4' : '',
    
    // xl col span (large desktops)
    colSpan.xl === 2 ? 'lg:col-span-2' : 
    colSpan.xl === 3 ? 'lg:col-span-3' : 
    colSpan.xl === 4 ? 'lg:col-span-4' : '',
  ].filter(Boolean);
  
  return (
    <div className={cn(colSpanClasses.join(' '), className)}>
      {children}
    </div>
  );
}
