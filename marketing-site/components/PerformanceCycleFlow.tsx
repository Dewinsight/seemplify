'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

export default function PerformanceCycleFlow() {
  const [activeIndex, setActiveIndex] = useState(0)
  
  const stages = [
    { label: 'Set Goals', emoji: '🎯', color: 'from-blue-500 to-cyan-400' },
    { label: 'Track Progress', emoji: '📈', color: 'from-purple-500 to-pink-400' },
    { label: 'Gather Feedback', emoji: '💬', color: 'from-amber-500 to-orange-400' },
    { label: 'Review & Grow', emoji: '🚀', color: 'from-green-500 to-emerald-400' },
  ]

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex(prev => (prev + 1) % stages.length)
    }, 2500)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="relative w-full max-w-md mx-auto">
      {/* Center circle */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center shadow-2xl shadow-purple-500/30 z-10">
        <span className="text-2xl font-bold">360°</span>
      </div>

      {/* Rotating stages */}
      <svg viewBox="0 0 300 300" className="w-full h-auto">
        {/* Connection circle */}
        <circle
          cx="150"
          cy="150"
          r="100"
          fill="none"
          stroke="url(#circleGradient)"
          strokeWidth="2"
          strokeDasharray="8 4"
          className="opacity-30"
        />
        
        {/* Animated progress arc */}
        <motion.circle
          cx="150"
          cy="150"
          r="100"
          fill="none"
          stroke="url(#progressGradient)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="628"
          initial={{ strokeDashoffset: 628 }}
          animate={{ strokeDashoffset: 628 - (activeIndex + 1) * 157 }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
        />

        <defs>
          <linearGradient id="circleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
          <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
      </svg>

      {/* Stage nodes positioned around the circle */}
      {stages.map((stage, index) => {
        const angle = (index * 90 - 90) * (Math.PI / 180)
        const x = 50 + 38 * Math.cos(angle)
        const y = 50 + 38 * Math.sin(angle)
        const isActive = index === activeIndex

        return (
          <motion.div
            key={stage.label}
            className="absolute"
            style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
            animate={{ scale: isActive ? 1.1 : 1 }}
          >
            <div className={`
              px-4 py-3 rounded-xl border-2 backdrop-blur
              ${isActive ? `border-white/50 bg-gradient-to-br ${stage.color} shadow-xl` : 'border-white/20 bg-slate-900/80'}
              transition-all duration-300
            `}>
              <div className="flex items-center gap-2">
                <span className="text-xl">{stage.emoji}</span>
                <span className={`text-sm font-semibold ${isActive ? 'text-white' : 'text-slate-300'}`}>
                  {stage.label}
                </span>
              </div>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
