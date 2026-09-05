'use client';

import { motion } from 'framer-motion';
import NumberTicker from '@/components/landing/motion/NumberTicker';

// Same figures the page already quotes in the matching demo and hero chips.
const STATS = [
  { value: 95.8, decimals: 1, suffix: '%', label: 'Match accuracy', detail: 'AI-ranked shortlists' },
  { value: 62, decimals: 0, suffix: '%', label: 'Faster time-to-hire', detail: 'Scheduling and screening automated' },
  { value: 98, decimals: 0, suffix: '%', label: 'Match rate', detail: 'Top talent surfaced in seconds' },
];

export default function SignalStats() {
  return (
    <section aria-label="Platform results" className="relative z-10 container mx-auto px-4 pb-8 pt-2 md:pb-14">
      <div className="grid grid-cols-1 divide-y divide-white/10 rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-xl sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {STATS.map((stat, i) => (
          <motion.div
            key={stat.label}
            className="px-8 py-8 md:py-10"
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ duration: 0.6, delay: i * 0.12 }}
          >
            <div className="text-5xl font-black tracking-tight md:text-6xl">
              <NumberTicker
                value={stat.value}
                decimals={stat.decimals}
                suffix={stat.suffix}
                className="bg-gradient-to-r from-blue-300 via-purple-300 to-pink-300 bg-clip-text text-transparent"
              />
            </div>
            <div className="mt-2 text-lg font-semibold text-white">{stat.label}</div>
            <div className="text-sm text-slate-400">{stat.detail}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
