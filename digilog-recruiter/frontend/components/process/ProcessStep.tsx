'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LucideIcon, ChevronDown } from 'lucide-react';
import GlassmorphicCard from '@/components/ui/glassmorphic-card';
import ScrollReveal from '@/components/animations/ScrollReveal';

interface Step {
  icon: LucideIcon;
  title: string;
  description: string;
  details: string;
  color: string;
  iconColor: string;
}

interface ProcessStepProps {
  step: Step;
  index: number;
  layout: 'horizontal' | 'vertical';
}

export default function ProcessStep({ step, index, layout }: ProcessStepProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const Icon = step.icon;
  
  if (layout === 'horizontal') {
    return (
      <ScrollReveal delay={index * 0.15}>
        <div className="relative pt-32">
          {/* Step number badge - positioned above */}
          <motion.div 
            className={`absolute top-16 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-gradient-to-br ${step.color} flex items-center justify-center text-white font-bold text-xl shadow-xl border-4 border-slate-950 z-10`}
            initial={{ scale: 0, rotate: -180 }}
            whileInView={{ scale: 1, rotate: 0 }}
            viewport={{ once: true }}
            transition={{ 
              delay: index * 0.15 + 0.2,
              type: "spring",
              stiffness: 200,
              damping: 15
            }}
          >
            {index + 1}
          </motion.div>
          
          {/* Card */}
          <GlassmorphicCard 
            variant="interactive" 
            className="p-6 h-full group cursor-pointer"
            hover={true}
          >
            <div 
              className="flex flex-col items-center text-center"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {/* Icon */}
              <motion.div 
                className={`w-16 h-16 mb-4 rounded-xl flex items-center justify-center bg-gradient-to-br ${step.color} shadow-lg`}
                whileHover={{ 
                  scale: 1.1, 
                  rotate: [0, -5, 5, -5, 0],
                  transition: { duration: 0.5 }
                }}
              >
                <Icon className="w-8 h-8 text-white" />
              </motion.div>
              
              {/* Title */}
              <h3 className="text-xl font-bold mb-2 text-white group-hover:text-green-300 transition-colors">
                {step.title}
              </h3>
              
              {/* Description */}
              <p className="text-slate-300 text-sm leading-relaxed mb-3">
                {step.description}
              </p>
              
              {/* Expand indicator */}
              <motion.div 
                className="flex items-center gap-1 text-xs text-green-400 font-medium"
                animate={{ y: isExpanded ? 0 : [0, 3, 0] }}
                transition={{ repeat: isExpanded ? 0 : Infinity, duration: 1.5 }}
              >
                <span>Learn more</span>
                <motion.div
                  animate={{ rotate: isExpanded ? 180 : 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <ChevronDown className="w-4 h-4" />
                </motion.div>
              </motion.div>
              
              {/* Expandable details */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <p className="text-slate-400 text-sm leading-relaxed">
                        {step.details}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </GlassmorphicCard>
        </div>
      </ScrollReveal>
    );
  }
  
  // Vertical layout
  return (
    <ScrollReveal delay={index * 0.1} direction="right">
      <div className="relative flex gap-6">
        {/* Step number badge - positioned on the left */}
        <motion.div 
          className={`flex-shrink-0 w-16 h-16 rounded-full bg-gradient-to-br ${step.color} flex items-center justify-center text-white font-bold text-2xl shadow-xl border-4 border-slate-950 z-10`}
          initial={{ scale: 0, rotate: -180 }}
          whileInView={{ scale: 1, rotate: 0 }}
          viewport={{ once: true }}
          transition={{ 
            delay: index * 0.1 + 0.2,
            type: "spring",
            stiffness: 200,
            damping: 15
          }}
        >
          {index + 1}
        </motion.div>
        
        {/* Card */}
        <div className="flex-1">
          <GlassmorphicCard 
            variant="interactive" 
            className="p-6 group cursor-pointer"
            hover={true}
          >
            <div onClick={() => setIsExpanded(!isExpanded)}>
              <div className="flex items-start gap-4 mb-3">
                {/* Icon */}
                <motion.div 
                  className={`flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center bg-gradient-to-br ${step.color} shadow-lg`}
                  whileHover={{ 
                    scale: 1.1, 
                    rotate: [0, -5, 5, -5, 0],
                    transition: { duration: 0.5 }
                  }}
                >
                  <Icon className="w-7 h-7 text-white" />
                </motion.div>
                
                <div className="flex-1">
                  {/* Title */}
                  <h3 className="text-2xl font-bold mb-2 text-white group-hover:text-green-300 transition-colors">
                    {step.title}
                  </h3>
                  
                  {/* Description */}
                  <p className="text-slate-300 text-base leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </div>
              
              {/* Expand indicator */}
              <motion.div 
                className="flex items-center gap-1 text-sm text-green-400 font-medium mt-3"
                animate={{ x: isExpanded ? 0 : [0, 3, 0] }}
                transition={{ repeat: isExpanded ? 0 : Infinity, duration: 1.5 }}
              >
                <span>Learn more</span>
                <motion.div
                  animate={{ rotate: isExpanded ? 180 : 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <ChevronDown className="w-4 h-4" />
                </motion.div>
              </motion.div>
              
              {/* Expandable details */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <p className="text-slate-400 text-base leading-relaxed">
                        {step.details}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </GlassmorphicCard>
        </div>
      </div>
    </ScrollReveal>
  );
}
