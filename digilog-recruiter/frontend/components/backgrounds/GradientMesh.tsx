'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useBrandConfig } from '@/context/BrandContext';

interface GradientMeshProps {
  className?: string;
}

export const GradientMesh: React.FC<GradientMeshProps> = ({ className }) => {
  const brand = useBrandConfig();
  const jet = brand.id === 'jetstone';
  const dig = brand.id === 'digilog';
  const reduceMotion = useReducedMotion();
  /** Jetstone portal: static orbs only — animated blurs were a major scroll/jank source. */
  const staticOrbs = jet || reduceMotion;

  // diGiLog light theme: soft, low-opacity purple/indigo orbs on a near-white canvas.
  if (dig) {
    return (
      <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#754BE5]/[0.12] rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-[#A284F1]/[0.14] rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-[#1E0059]/[0.06] rounded-full blur-3xl" />
        <div className="absolute top-2/3 right-1/3 w-80 h-80 bg-[#754BE5]/[0.10] rounded-full blur-3xl" />
        {/* Grid Overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1E005908_1px,transparent_1px),linear-gradient(to_bottom,#1E005908_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>
    );
  }

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      {/* Gradient Orbs — green/amber for Jetstone; blue/purple default */}
      {staticOrbs ? (
        <>
          <div
            className={
              jet
                ? 'absolute top-0 left-1/4 w-96 h-96 bg-green-500/22 rounded-full blur-3xl'
                : 'absolute top-0 left-1/4 w-96 h-96 bg-blue-500/30 rounded-full blur-3xl'
            }
          />
          <div
            className={
              jet
                ? 'absolute top-1/3 right-1/4 w-96 h-96 bg-amber-400/22 rounded-full blur-3xl'
                : 'absolute top-1/3 right-1/4 w-96 h-96 bg-purple-500/30 rounded-full blur-3xl'
            }
          />
          <div
            className={
              jet
                ? 'absolute bottom-1/4 left-1/3 w-96 h-96 bg-yellow-400/16 rounded-full blur-3xl'
                : 'absolute bottom-1/4 left-1/3 w-96 h-96 bg-pink-500/20 rounded-full blur-3xl'
            }
          />
          <div
            className={
              jet
                ? 'absolute top-2/3 right-1/3 w-80 h-80 bg-green-700/14 rounded-full blur-3xl'
                : 'absolute top-2/3 right-1/3 w-80 h-80 bg-cyan-500/20 rounded-full blur-3xl'
            }
          />
        </>
      ) : (
        <>
          <motion.div
            className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/30 rounded-full blur-3xl"
            animate={{ scale: [1, 1.2, 1], x: [0, 50, 0], y: [0, 30, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute top-1/3 right-1/4 w-96 h-96 bg-purple-500/30 rounded-full blur-3xl"
            animate={{ scale: [1, 1.3, 1], x: [0, -30, 0], y: [0, 50, 0] }}
            transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-pink-500/20 rounded-full blur-3xl"
            animate={{ scale: [1, 1.1, 1], x: [0, 40, 0], y: [0, -40, 0] }}
            transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute top-2/3 right-1/3 w-80 h-80 bg-cyan-500/20 rounded-full blur-3xl"
            animate={{ scale: [1, 1.25, 1], x: [0, -50, 0], y: [0, -30, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
          />
        </>
      )}

      {/* Grid Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:48px_48px]" />
    </div>
  );
};

export default GradientMesh;
