import React from 'react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface GlassmorphicCardProps {
  children: React.ReactNode;
  variant?: 'default' | 'elevated' | 'interactive';
  className?: string;
  hover?: boolean;
}

export const GlassmorphicCard: React.FC<GlassmorphicCardProps> = ({
  children,
  variant = 'default',
  className,
  hover = true,
}) => {
  const baseClasses = 'rounded-2xl backdrop-blur-xl border transition-all duration-300';
  
  const variants = {
    default: 'bg-white/5 border-white/10 shadow-lg',
    elevated: 'bg-white/10 border-white/20 shadow-2xl shadow-black/20',
    interactive: 'bg-white/5 border-white/10 shadow-lg hover:bg-white/10 hover:border-white/30 hover:shadow-2xl hover:shadow-purple-500/20',
  };
  
  const hoverEffect = hover ? 'hover:-translate-y-1 hover:scale-[1.02]' : '';
  
  return (
    <motion.div
      className={cn(
        baseClasses,
        variants[variant],
        hoverEffect,
        className
      )}
      whileHover={hover ? { y: -4 } : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      {children}
    </motion.div>
  );
};

export default GlassmorphicCard;
