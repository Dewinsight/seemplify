'use client'

import { motion } from 'framer-motion'

// Premium "fluid" easing
const fluidEase = [0.25, 0.46, 0.45, 0.94]

// Abstract Node/Network Illustration (Replacing Team)
export function TeamIllustration() {
  return (
    <div className="relative w-full h-64 flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-radial from-violet-500/10 to-transparent opacity-50" />

      {/* Central Hub */}
      <motion.div
        className="relative z-10 w-24 h-24 rounded-full border border-violet-500/30 bg-violet-900/10 backdrop-blur-sm flex items-center justify-center"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.5, ease: fluidEase }}
      >
        <div className="w-16 h-16 rounded-full border border-violet-400/50 bg-violet-500/10 animate-pulse-subtle" />
      </motion.div>

      {/* Orbiting Nodes */}
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="absolute w-full h-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 20 + i * 5, ease: "linear", repeat: Infinity, delay: i * -5 }}
        >
          <motion.div
            className="absolute top-1/2 left-1/2 w-3 h-3 -ml-1.5 -mt-1.5 rounded-full bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.5)]"
            style={{ transform: `translateX(${80 + i * 25}px)` }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.5 + i * 0.2, duration: 0.8 }}
          />
          {/* Connecting Lines */}
          <motion.div
            className="absolute top-1/2 left-1/2 h-[1px] bg-gradient-to-r from-violet-500/0 via-violet-500/20 to-violet-500/0"
            style={{
              width: `${80 + i * 25}px`,
              transformOrigin: "left center",
              transform: "rotate(0deg)"
            }}
          />
        </motion.div>
      ))}
    </div>
  )
}

// Abstract Timeline/Grid Illustration (Replacing Calendar)
export function CalendarIllustration() {
  return (
    <div className="relative w-full h-64 flex items-center justify-center overflow-hidden">
      {/* Perspective Grid */}
      <div className="absolute inset-x-0 bottom-0 h-full bg-[linear-gradient(transparent_0%,rgba(139,92,246,0.05)_100%)]" />

      <div className="flex gap-2 items-end h-32">
        {[...Array(7)].map((_, i) => (
          <motion.div
            key={i}
            className="w-8 rounded-t-sm bg-gradient-to-t from-violet-900/40 to-violet-500/10 border-x border-t border-violet-500/20 backdrop-blur-sm relative overflow-hidden"
            initial={{ height: "20%" }}
            animate={{ height: ["20%", "60%", "40%", "80%", "30%"][i % 5] }}
            transition={{
              duration: 4,
              repeat: Infinity,
              repeatType: "reverse",
              ease: "easeInOut",
              delay: i * 0.2
            }}
          >
            <div className="absolute inset-x-0 top-0 h-[1px] bg-violet-400/30" />
            <motion.div
              className="absolute inset-x-0 top-0 h-full bg-gradient-to-b from-violet-400/10 to-transparent"
              animate={{ opacity: [0, 0.5, 0] }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.3 }}
            />
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// Technical Chart Illustration
export function ChartIllustration() {
  return (
    <div className="relative w-full h-64 flex items-center justify-center">
      <svg className="w-full h-full max-w-[300px]" viewBox="0 0 300 150">
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a855f7" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid Lines */}
        {[1, 2, 3].map(i => (
          <line key={i} x1="0" y1={i * 37.5} x2="300" y2={i * 37.5} stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1" strokeDasharray="4 4" />
        ))}

        {/* Data Line */}
        <motion.path
          d="M0,100 C50,100 50,40 100,40 C150,40 150,80 200,80 C250,80 250,20 300,20 L300,150 L0,150 Z"
          fill="url(#chartFill)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1 }}
        />
        <motion.path
          d="M0,100 C50,100 50,40 100,40 C150,40 150,80 200,80 C250,80 250,20 300,20"
          fill="none"
          stroke="#c084fc"
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 2.5, ease: fluidEase }}
        />

        {/* Data Points */}
        {[0.33, 0.66, 1].map((p, i) => (
          <motion.circle
            key={i}
            cx={p * 300}
            cy={p === 0.33 ? 40 : p === 0.66 ? 80 : 20}
            r="3"
            fill="#ffffff"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 1 + i * 0.5, duration: 0.5 }}
          />
        ))}
      </svg>
    </div>
  )
}

// Abstract Data Flow (Replacing Payroll)
export function PayrollIllustration() {
  return (
    <div className="relative w-full h-64 flex items-center justify-center overflow-hidden">
      <div className="absolute w-[200px] h-[1px] bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />

      {/* flowing bits */}
      {[...Array(5)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute h-[1px] w-12 bg-gradient-to-r from-transparent via-amber-400 to-transparent"
          style={{ top: "50%", left: "0%" }}
          animate={{
            x: [0, 300],
            opacity: [0, 1, 0]
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            delay: i * 0.4,
            ease: "easeInOut"
          }}
        />
      ))}

      {/* Central Processor */}
      <div className="relative z-10 w-32 h-20 border border-amber-500/20 bg-amber-900/10 backdrop-blur-md rounded flex items-center justify-center">
        <div className="text-amber-400 font-mono text-xs tracking-widest">PROCESSING</div>
        <motion.div
          className="absolute inset-0 border border-amber-400/30 rounded"
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      </div>
    </div>
  )
}

export function WorkflowConnector() {
  return null;
}

// Learning Illustration (Tree/Growth)
export function LearningIllustration() {
  return (
    <div className="relative w-full h-64 flex items-center justify-center overflow-hidden">
      {/* Abstract Tree Structure */}
      <div className="absolute inset-0 flex items-end justify-center">
        <motion.div
          className="w-1 h-32 bg-sky-500/20 rounded-t-full"
          initial={{ height: 0 }}
          animate={{ height: 128 }}
          transition={{ duration: 1.5, ease: fluidEase }}
        />
      </div>

      {/* Branches/Nodes */}
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute"
          style={{ bottom: 128 + (i * 30), left: '50%' }}
          initial={{ scale: 0, x: '-50%' }}
          animate={{ scale: 1, x: '-50%' }}
          transition={{ delay: 0.5 + (i * 0.3), duration: 0.8, ease: "backOut" }}
        >
          <div className={`w-${16 - i * 4} h-${16 - i * 4} rounded-full border border-sky-400/30 bg-sky-500/10 backdrop-blur-sm`} />
        </motion.div>
      ))}

      {/* Orbiting Particles */}
      {[0, 1].map((i) => (
        <motion.div
          key={`p-${i}`}
          className="absolute w-40 h-40 border border-sky-500/10 rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 10 + i * 5, ease: "linear", repeat: Infinity, reverse: i % 2 === 0 }}
        >
          <div className="absolute top-0 left-1/2 w-2 h-2 -ml-1 bg-sky-400 rounded-full shadow-[0_0_8px_rgba(56,189,248,0.5)]" />
        </motion.div>
      ))}
    </div>
  )
}

// Knowledge/Docs Illustration (Connected Network)
export function KnowledgeIllustration() {
  return (
    <div className="relative w-full h-64 flex items-center justify-center">
      <div className="relative w-48 h-48">
        {/* Central Doc */}
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-20 bg-blue-500/10 border border-blue-400/30 rounded-lg backdrop-blur-md z-10"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8 }}
        >
          <div className="w-8 h-1 bg-blue-400/30 rounded mt-3 mx-auto" />
          <div className="w-10 h-1 bg-blue-400/30 rounded mt-2 mx-auto" />
        </motion.div>

        {/* Connected Docs */}
        {[0, 1, 2, 3].map((i) => (
          <motion.div
            key={i}
            className="absolute top-1/2 left-1/2 w-12 h-14 bg-white/5 border border-blue-300/20 rounded backdrop-blur-sm"
            initial={{ x: '-50%', y: '-50%', opacity: 0 }}
            animate={{
              x: `calc(-50% + ${Math.cos(i * 1.57) * 80}px)`,
              y: `calc(-50% + ${Math.sin(i * 1.57) * 80}px)`,
              opacity: 1
            }}
            transition={{ delay: 0.4 + i * 0.1, duration: 0.8, ease: fluidEase }}
          />
        ))}

        {/* Lines */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {[0, 1, 2, 3].map((i) => (
            <motion.line
              key={i}
              x1="50%" y1="50%"
              x2="50%" y2="50%"
              stroke="rgba(59, 130, 246, 0.2)"
              strokeWidth="1"
              initial={{ pathLength: 0 }}
              animate={{
                x2: `${50 + Math.cos(i * 1.57) * 35}%`,
                y2: `${50 + Math.sin(i * 1.57) * 35}%`,
                pathLength: 1
              }}
              transition={{ delay: 0.8, duration: 0.5 }}
            />
          ))}
        </svg>
      </div>
    </div>
  )
}

// AI Chat Illustration (Neural/Waveform)
export function ChatIllustration() {
  return (
    <div className="relative w-full h-64 flex items-center justify-center overflow-hidden">
      {/* Waveforms */}
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute inset-0 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ duration: 1 }}
        >
          <svg viewBox="0 0 100 20" className="w-full h-20 opacity-50">
            <motion.path
              d="M0,10 Q25,20 50,10 T100,10"
              fill="none"
              stroke="#8b5cf6"
              strokeWidth="0.5"
              initial={{ pathLength: 0, d: "M0,10 Q25,10 50,10 T100,10" }}
              animate={{
                d: ["M0,10 Q25,20 50,10 T100,10", "M0,10 Q25,0 50,10 T100,10", "M0,10 Q25,20 50,10 T100,10"]
              }}
              transition={{
                duration: 3 + i,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.5
              }}
            />
          </svg>
        </motion.div>
      ))}

      {/* Central Pulse */}
      <motion.div
        className="relative z-10 w-12 h-12 rounded-full bg-violet-500/20 backdrop-blur-md border border-violet-400/50 flex items-center justify-center"
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <div className="w-2 h-2 bg-violet-400 rounded-full shadow-[0_0_10px_#8b5cf6]" />
      </motion.div>
    </div>
  )
}
