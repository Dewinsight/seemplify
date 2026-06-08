'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp } from 'lucide-react';
import { useBrandConfig } from '@/context/BrandContext';

export const BackToTop: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const brand = useBrandConfig();
  const isJetstone = brand.id === 'jetstone';

  useEffect(() => {
    const toggleVisibility = () => {
      if (window.pageYOffset > 500) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    window.addEventListener('scroll', toggleVisibility);

    return () => {
      window.removeEventListener('scroll', toggleVisibility);
    };
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.5, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.5, y: 20 }}
          onClick={scrollToTop}
          className={
            isJetstone
              ? 'fixed bottom-8 right-8 p-4 rounded-full bg-gradient-to-br from-green-600 via-emerald-700 to-green-900 hover:from-green-700 hover:via-emerald-800 hover:to-green-950 shadow-2xl shadow-green-900/30 ring-2 ring-white/25 hover:shadow-green-950/40 transition-all duration-300 z-50 group'
              : 'fixed bottom-8 right-8 p-4 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 shadow-2xl shadow-purple-500/50 hover:shadow-purple-500/70 transition-all duration-300 z-50 group'
          }
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <ArrowUp
            className={
              isJetstone
                ? 'w-6 h-6 text-amber-50 drop-shadow-sm group-hover:animate-bounce'
                : 'w-6 h-6 text-white group-hover:animate-bounce'
            }
            aria-hidden
          />
        </motion.button>
      )}
    </AnimatePresence>
  );
};

export default BackToTop;
