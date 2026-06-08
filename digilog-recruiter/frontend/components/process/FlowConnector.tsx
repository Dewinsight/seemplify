'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, ArrowRight } from 'lucide-react';

interface FlowConnectorProps {
  layout: 'horizontal' | 'vertical';
}

export default function FlowConnector({ layout }: FlowConnectorProps) {
  if (layout === 'horizontal') {
    return (
      <motion.div 
        className="flex items-center justify-center"
        initial={{ opacity: 0, scaleX: 0 }}
        whileInView={{ opacity: 1, scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <div className="h-0.5 w-full bg-gradient-to-r from-white/20 to-white/40"></div>
        <motion.div
          animate={{ x: [0, 10, 0] }}
          transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
        >
          <ArrowRight className="w-5 h-5 text-white/40 mx-2" />
        </motion.div>
        <div className="h-0.5 w-full bg-gradient-to-r from-white/40 to-white/20"></div>
      </motion.div>
    );
  }
  
  // Vertical layout
  return (
    <motion.div 
      className="flex flex-col items-center justify-center my-4 ml-8"
      initial={{ opacity: 0, scaleY: 0 }}
      whileInView={{ opacity: 1, scaleY: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: 0.2 }}
    >
      <div className="w-0.5 h-8 bg-gradient-to-b from-white/20 to-white/40"></div>
      <motion.div
        animate={{ y: [0, 10, 0] }}
        transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
      >
        <ArrowDown className="w-5 h-5 text-white/40 my-2" />
      </motion.div>
      <div className="w-0.5 h-8 bg-gradient-to-b from-white/40 to-white/20"></div>
    </motion.div>
  );
}
