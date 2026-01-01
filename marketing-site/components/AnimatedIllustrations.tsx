'use client'

import { motion } from 'framer-motion'

// Smooth easing curve for all animations
const smoothEase = [0.16, 1, 0.3, 1]

// Animated Team Illustration
export function TeamIllustration() {
  return (
    <div className="relative w-64 h-64">
      <svg viewBox="0 0 200 200" className="w-full h-full">
        <defs>
          <radialGradient id="teamGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="personGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#818cf8" />
          </linearGradient>
          <linearGradient id="personGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
          <linearGradient id="personGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#c084fc" />
          </linearGradient>
        </defs>

        <circle cx="100" cy="100" r="80" fill="url(#teamGlow)" />

        {/* Person 1 - Left */}
        <motion.g
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: smoothEase }}
        >
          <circle cx="55" cy="85" r="18" fill="url(#personGrad1)" />
          <rect x="40" y="108" width="30" height="45" rx="8" fill="url(#personGrad1)" />
        </motion.g>

        {/* Person 2 - Center (larger) */}
        <motion.g
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3, ease: smoothEase }}
        >
          <circle cx="100" cy="70" r="22" fill="url(#personGrad2)" />
          <rect x="80" y="98" width="40" height="55" rx="10" fill="url(#personGrad2)" />
        </motion.g>

        {/* Person 3 - Right */}
        <motion.g
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4, ease: smoothEase }}
        >
          <circle cx="145" cy="85" r="18" fill="url(#personGrad3)" />
          <rect x="130" y="108" width="30" height="45" rx="8" fill="url(#personGrad3)" />
        </motion.g>

        {/* Subtle connection lines */}
        <motion.path
          d="M 55 100 Q 78 70 100 92"
          stroke="white"
          strokeWidth="1"
          fill="none"
          opacity="0.15"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.6, duration: 0.8, ease: smoothEase }}
        />
        <motion.path
          d="M 100 92 Q 122 70 145 100"
          stroke="white"
          strokeWidth="1"
          fill="none"
          opacity="0.15"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.8, duration: 0.8, ease: smoothEase }}
        />
      </svg>
    </div>
  )
}

// Animated Calendar Illustration
export function CalendarIllustration() {
  return (
    <div className="relative w-64 h-64">
      <svg viewBox="0 0 200 200" className="w-full h-full">
        <defs>
          <linearGradient id="calGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>

        {/* Calendar base */}
        <motion.rect
          x="30"
          y="40"
          width="140"
          height="130"
          rx="12"
          fill="#18181b"
          stroke="#27272a"
          strokeWidth="1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, ease: smoothEase }}
        />

        {/* Calendar header */}
        <motion.rect
          x="30"
          y="40"
          width="140"
          height="35"
          rx="12"
          fill="url(#calGrad)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.5, ease: smoothEase }}
        />

        {/* Header text */}
        <text x="100" y="63" textAnchor="middle" fill="white" fontSize="13" fontWeight="500">
          January 2025
        </text>

        {/* Calendar grid - simplified */}
        {[0, 1, 2, 3, 4].map((row) => (
          [0, 1, 2, 3, 4, 5, 6].map((col) => {
            const day = row * 7 + col + 1
            if (day > 31) return null
            const isHighlighted = [8, 9, 10, 15, 22].includes(day)
            return (
              <motion.g key={`${row}-${col}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15 + (row * 7 + col) * 0.015, duration: 0.4, ease: smoothEase }}
              >
                <rect
                  x={38 + col * 18}
                  y={85 + row * 17}
                  width="14"
                  height="14"
                  rx="3"
                  fill={isHighlighted ? '#10b981' : 'transparent'}
                  opacity={isHighlighted ? 0.2 : 1}
                />
                <text
                  x={45 + col * 18}
                  y={95 + row * 17}
                  textAnchor="middle"
                  fill={isHighlighted ? '#34d399' : '#52525b'}
                  fontSize="8"
                >
                  {day <= 31 ? day : ''}
                </text>
              </motion.g>
            )
          })
        ))}

        {/* Floating badge */}
        <motion.g
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.6, duration: 0.5, ease: smoothEase }}
        >
          <rect x="130" y="25" width="50" height="24" rx="12" fill="#10b981" />
          <text x="155" y="41" textAnchor="middle" fill="white" fontSize="10" fontWeight="500">
            3 days
          </text>
        </motion.g>
      </svg>
    </div>
  )
}

// Animated Chart Illustration
export function ChartIllustration() {
  const bars = [40, 65, 45, 80, 55, 90, 70]

  return (
    <div className="relative w-64 h-64">
      <svg viewBox="0 0 200 200" className="w-full h-full">
        <defs>
          <linearGradient id="chartGrad" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#c084fc" />
          </linearGradient>
        </defs>

        {/* Grid lines - subtle */}
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1="30"
            y1={40 + i * 35}
            x2="180"
            y2={40 + i * 35}
            stroke="#27272a"
            strokeWidth="1"
          />
        ))}

        {/* Bars */}
        {bars.map((height, i) => (
          <motion.rect
            key={i}
            x={35 + i * 22}
            width="16"
            rx="4"
            fill="url(#chartGrad)"
            initial={{ y: 175, height: 0 }}
            animate={{ y: 175 - height, height: height }}
            transition={{ delay: 0.08 * i, duration: 0.6, ease: smoothEase }}
          />
        ))}

        {/* Trend line */}
        <motion.path
          d="M 43 140 L 65 110 L 87 125 L 109 85 L 131 105 L 153 65 L 175 90"
          stroke="url(#lineGrad)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.4, duration: 0.8, ease: smoothEase }}
        />

        {/* Dots on trend line */}
        {[
          { x: 43, y: 140 },
          { x: 65, y: 110 },
          { x: 87, y: 125 },
          { x: 109, y: 85 },
          { x: 131, y: 105 },
          { x: 153, y: 65 },
          { x: 175, y: 90 },
        ].map((pos, i) => (
          <motion.circle
            key={i}
            cx={pos.x}
            cy={pos.y}
            r="3"
            fill="#a855f7"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.5 + i * 0.08, duration: 0.4, ease: smoothEase }}
          />
        ))}
      </svg>
    </div>
  )
}

// Animated Money/Payroll Illustration
export function PayrollIllustration() {
  return (
    <div className="relative w-64 h-64">
      <svg viewBox="0 0 200 200" className="w-full h-full">
        <defs>
          <linearGradient id="moneyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#fbbf24" />
          </linearGradient>
          <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#18181b" />
            <stop offset="100%" stopColor="#09090b" />
          </linearGradient>
        </defs>

        {/* Card background */}
        <motion.rect
          x="25"
          y="50"
          width="150"
          height="100"
          rx="12"
          fill="url(#cardGrad)"
          stroke="#27272a"
          strokeWidth="1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, ease: smoothEase }}
        />

        {/* Card chip */}
        <motion.rect
          x="40"
          y="70"
          width="30"
          height="22"
          rx="4"
          fill="#f59e0b"
          opacity="0.7"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.7 }}
          transition={{ delay: 0.2, duration: 0.4, ease: smoothEase }}
        />

        {/* Card number */}
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.4, ease: smoothEase }}
        >
          <text x="40" y="115" fill="#52525b" fontSize="10" fontFamily="monospace">
            •••• •••• •••• 4521
          </text>
        </motion.g>

        {/* Amount */}
        <motion.text
          x="40"
          y="138"
          fill="#34d399"
          fontSize="18"
          fontWeight="600"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4, duration: 0.5, ease: smoothEase }}
        >
          $12,450.00
        </motion.text>

        {/* Floating coins - subtle */}
        {[
          { x: 160, y: 40, delay: 0.5 },
          { x: 175, y: 55, delay: 0.6 },
          { x: 150, y: 25, delay: 0.7 },
        ].map((coin, i) => (
          <motion.g
            key={i}
            initial={{ y: coin.y + 12, opacity: 0 }}
            animate={{ y: coin.y, opacity: 1 }}
            transition={{ delay: coin.delay, duration: 0.5, ease: smoothEase }}
          >
            <circle cx={coin.x} cy={coin.y} r="12" fill="url(#moneyGrad)" />
            <text x={coin.x} y={coin.y + 4} textAnchor="middle" fill="#fff" fontSize="10" fontWeight="600">
              $
            </text>
          </motion.g>
        ))}

        {/* Success checkmark */}
        <motion.g
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.4, ease: smoothEase }}
        >
          <circle cx="160" cy="120" r="15" fill="#10b981" />
          <path
            d="M 152 120 L 157 125 L 168 114"
            stroke="white"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.g>
      </svg>
    </div>
  )
}

// Simplified Workflow Connector - no longer used but kept for compatibility
export function WorkflowConnector({ direction = 'right' }: { direction?: 'right' | 'down' }) {
  return null // Removed as it was too playful
}
