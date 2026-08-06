'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

type ActiveLinkProps = {
  href: string;
  children: React.ReactNode;
};

const ActiveLink = ({ href, children }: ActiveLinkProps) => {
  const [isActive, setIsActive] = useState(false);
  
  useEffect(() => {
    const targetId = href.replace('#', '');
    const targetElement = document.getElementById(targetId);
    
    if (!targetElement) return;
    
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Set active if the section is more than 50% visible
        setIsActive(entry.isIntersecting && entry.intersectionRatio >= 0.5);
      },
      {
        root: null, // Use viewport as root
        rootMargin: '-80px 0px -40% 0px', // Adjust margins to trigger at the right time
        threshold: [0.5], // Trigger when 50% visible
      }
    );
    
    observer.observe(targetElement);
    
    return () => {
      if (targetElement) {
        observer.unobserve(targetElement);
      }
    };
  }, [href]);
  
  return (
    <a 
      href={href} 
      className={`relative py-1 px-2 text-sm ${isActive ? 'text-white' : 'text-slate-300'} hover:text-white transition-colors`}
    >
      {children}
      {isActive && (
        <motion.div
          className="absolute -bottom-1 left-0 w-full h-0.5 bg-gradient-to-r from-blue-400 to-purple-500"
          layoutId="activeSection"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        />
      )}
    </a>
  );
};

export default ActiveLink;
