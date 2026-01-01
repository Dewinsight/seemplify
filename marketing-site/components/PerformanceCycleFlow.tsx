'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

// Icon components
const TargetIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
    <circle cx="12" cy="12" r="10" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="6" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
  </svg>
)

const ChartIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
  </svg>
)

const ChatBubbleIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
  </svg>
)

const ArrowTrendingIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
  </svg>
)

export default function PerformanceCycleFlow() {
  const [activeIndex, setActiveIndex] = useState(0)

  const stages = [
    { label: 'Set Goals', icon: <TargetIcon />, color: 'from-indigo-500 to-indigo-400' },
    { label: 'Track Progress', icon: <ChartIcon />, color: 'from-violet-500 to-violet-400' },
    { label: 'Get Feedback', icon: <ChatBubbleIcon />, color: 'from-purple-500 to-purple-400' },
    { label: 'Review & Grow', icon: <ArrowTrendingIcon />, color: 'from-fuchsia-500 to-fuchsia-400' },
  ]

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex(prev => (prev + 1) % stages.length)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="relative w-full max-w-sm mx-auto py-8">
      {/* Center circle */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center z-10">
        <span className="text-lg font-semibold text-white">360°</span>
      </div>

      {/* Rotating stages */}
      <svg viewBox="0 0 300 300" className="w-full h-auto">
        {/* Connection circle - subtle */}
        <circle
          cx="150"
          cy="150"
          r="90"
          fill="none"
          stroke="#27272a"
          strokeWidth="1"
        />

        {/* Animated progress arc */}
        <motion.circle
          cx="150"
          cy="150"
          r="90"
          fill="none"
          stroke="url(#progressGradient)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="565"
          initial={{ strokeDashoffset: 565 }}
          animate={{ strokeDashoffset: 565 - (activeIndex + 1) * 141.25 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
        />

        <defs>
          <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
      </svg>

      {/* Stage nodes positioned around the circle */}
      {stages.map((stage, index) => {
        const angle = (index * 90 - 90) * (Math.PI / 180)
        const x = 50 + 36 * Math.cos(angle)
        const y = 50 + 36 * Math.sin(angle)
        const isActive = index === activeIndex

        return (
          <motion.div
            key={stage.label}
            className="absolute"
            style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
            animate={{ scale: isActive ? 1.05 : 1 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={`
              px-4 py-3 rounded-xl border backdrop-blur
              ${isActive ? `border-zinc-600 bg-gradient-to-br ${stage.color} shadow-lg` : 'border-zinc-800 bg-zinc-900/90'}
              transition-all duration-300
            `}>
              <div className="flex items-center gap-2.5">
                <div className={`${isActive ? 'text-white' : 'text-zinc-500'} transition-colors duration-300`}>
                  {stage.icon}
                </div>
                <span className={`text-sm font-medium ${isActive ? 'text-white' : 'text-zinc-400'} transition-colors duration-300`}>
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
