'use client';

import React from 'react';
import { motion, useScroll } from 'framer-motion';

/**
 * Thin document scroll indicator. Uses scrollYProgress directly (no spring) to avoid
 * extra animation work on every scroll frame — useSpring was making long pages feel "heavy".
 */
export const ScrollProgress: React.FC = () => {
  const { scrollYProgress } = useScroll();

  return (
    <motion.div
      className="fixed top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 origin-left z-50 pointer-events-none"
      style={{ scaleX: scrollYProgress }}
    />
  );
};

export default ScrollProgress;
