'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBrandConfig } from '@/context/BrandContext';

type StickyHeaderProps = {
  children: React.ReactNode;
};

const StickyHeader = ({ children }: StickyHeaderProps) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const brand = useBrandConfig();
  const scrolledBg =
    brand.id === 'jetstone'
      ? 'py-3 bg-teal-950/88 backdrop-blur-md shadow-lg border-b border-teal-500/10'
      : 'py-3 bg-slate-900/90 backdrop-blur-md shadow-lg';

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 100) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <AnimatePresence>
      <motion.header
        className={`fixed top-0 left-0 w-full z-50 transition-all duration-300 ${
          isScrolled ? scrolledBg : 'py-6 bg-transparent'
        }`}
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        {children}
      </motion.header>
    </AnimatePresence>
  );
};

export default StickyHeader;
