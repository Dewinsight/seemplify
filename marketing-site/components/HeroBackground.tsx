'use client'

import { motion } from 'framer-motion'

const gridStyle = {
  backgroundImage:
    'linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)',
  backgroundSize: '80px 80px',
  maskImage: 'linear-gradient(to top, transparent 0%, black 45%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to top, transparent 0%, black 45%, transparent 100%)',
}

export default function HeroBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 bg-[#f7f7fb] dark:bg-[#020205]" />
      <div
        className="absolute inset-0 opacity-80 dark:hidden"
        style={{
          background:
            'radial-gradient(circle at 20% 15%, rgba(56,189,248,0.18), transparent 55%), radial-gradient(circle at 80% 0%, rgba(16,185,129,0.16), transparent 50%), radial-gradient(circle at 60% 70%, rgba(99,102,241,0.12), transparent 55%)',
        }}
      />

      <motion.div
        className="absolute -top-24 left-10 h-[420px] w-[420px] rounded-full blur-[120px] opacity-60 dark:opacity-70"
        style={{
          background:
            'radial-gradient(circle at 30% 30%, var(--aurora-violet), transparent 70%)',
        }}
        animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        className="absolute top-1/3 -right-24 h-[520px] w-[520px] rounded-full blur-[140px] opacity-50 dark:opacity-60"
        style={{
          background:
            'radial-gradient(circle at 60% 40%, var(--aurora-cyan), transparent 70%)',
        }}
        animate={{ x: [0, -70, 0], y: [0, 50, 0] }}
        transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        className="absolute bottom-[-140px] left-1/3 h-[520px] w-[520px] rounded-full blur-[140px] opacity-40 dark:opacity-50"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, var(--aurora-emerald), transparent 70%)',
        }}
        animate={{ x: [0, 50, 0], y: [0, -40, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div
        className="absolute inset-x-0 bottom-[-45%] h-[85%]"
        style={{ transform: 'perspective(1200px) rotateX(72deg)' }}
      >
        <motion.div
          className="absolute inset-0 opacity-40"
          style={gridStyle}
          animate={{ backgroundPosition: ['0px 0px', '0px 160px'] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/70 to-[#f7f7fb] dark:via-[#020205]/60 dark:to-[#020205]" />
      <div className="absolute inset-x-0 top-[55%] h-px bg-gradient-to-r from-transparent via-black/10 to-transparent dark:via-white/15" />
    </div>
  )
}
