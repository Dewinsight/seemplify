'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Users, Clock, Award } from 'lucide-react';
import ScrollReveal from '@/components/animations/ScrollReveal';
import GlassmorphicCard from '@/components/ui/glassmorphic-card';

const stats = [
  {
    icon: <Users className="w-8 h-8" />,
    value: "10,000+",
    label: "Companies Trust Us",
    gradient: "from-[#F1ECFF]0 to-cyan-400",
    delay: 0.1
  },
  {
    icon: <TrendingUp className="w-8 h-8" />,
    value: "95.8%",
    label: "Match Accuracy",
    gradient: "from-purple-500 to-[#9B7BEC]",
    delay: 0.2
  },
  {
    icon: <Clock className="w-8 h-8" />,
    value: "62%",
    label: "Faster Time-to-Hire",
    gradient: "from-green-500 to-emerald-400",
    delay: 0.3
  },
  {
    icon: <Award className="w-8 h-8" />,
    value: "4.9/5",
    label: "Customer Rating",
    gradient: "from-amber-500 to-orange-400",
    delay: 0.4
  }
];

export const StatsSection: React.FC = () => {
  return (
    <section className="relative z-10 container mx-auto px-4 py-16 md:py-24">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <ScrollReveal key={index} delay={stat.delay}>
            <GlassmorphicCard variant="interactive" className="p-8 text-center h-full">
              <motion.div
                className={`w-16 h-16 mx-auto mb-4 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center shadow-lg`}
                whileHover={{ rotate: [0, -10, 10, -5, 0], scale: 1.1 }}
                transition={{ duration: 0.5 }}
              >
                {stat.icon}
              </motion.div>
              
              <motion.div
                className="text-4xl md:text-5xl font-black text-white mb-2"
                initial={{ scale: 0.5, opacity: 0 }}
                whileInView={{ scale: 1, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: stat.delay + 0.2, duration: 0.5, type: "spring" }}
              >
                {stat.value}
              </motion.div>
              
              <div className="text-slate-300 text-lg font-medium">
                {stat.label}
              </div>
            </GlassmorphicCard>
          </ScrollReveal>
        ))}
      </div>
    </section>
  );
};

export default StatsSection;
