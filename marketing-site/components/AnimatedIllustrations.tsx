'use client'

import { motion } from 'framer-motion'

// Animated Team Illustration
export function TeamIllustration() {
  return (
    <div className="relative w-64 h-64">
      <svg viewBox="0 0 200 200" className="w-full h-full">
        {/* Background glow */}
        <defs>
          <radialGradient id="teamGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="personGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
          <linearGradient id="personGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
          <linearGradient id="personGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ec4899" />
            <stop offset="100%" stopColor="#f43f5e" />
          </linearGradient>
        </defs>
        
        <circle cx="100" cy="100" r="80" fill="url(#teamGlow)" />
        
        {/* Person 1 - Left */}
        <motion.g
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <circle cx="55" cy="85" r="18" fill="url(#personGrad1)" />
          <rect x="40" y="108" width="30" height="45" rx="8" fill="url(#personGrad1)" />
        </motion.g>
        
        {/* Person 2 - Center (larger) */}
        <motion.g
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <circle cx="100" cy="70" r="22" fill="url(#personGrad2)" />
          <rect x="80" y="98" width="40" height="55" rx="10" fill="url(#personGrad2)" />
        </motion.g>
        
        {/* Person 3 - Right */}
        <motion.g
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <circle cx="145" cy="85" r="18" fill="url(#personGrad3)" />
          <rect x="130" y="108" width="30" height="45" rx="8" fill="url(#personGrad3)" />
        </motion.g>
        
        {/* Connection lines */}
        <motion.path
          d="M 55 100 Q 78 60 100 92"
          stroke="white"
          strokeWidth="2"
          strokeDasharray="4 4"
          fill="none"
          opacity="0.3"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.6, duration: 1 }}
        />
        <motion.path
          d="M 100 92 Q 122 60 145 100"
          stroke="white"
          strokeWidth="2"
          strokeDasharray="4 4"
          fill="none"
          opacity="0.3"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.8, duration: 1 }}
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
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
        </defs>
        
        {/* Calendar base */}
        <motion.rect
          x="30"
          y="40"
          width="140"
          height="130"
          rx="12"
          fill="#1e293b"
          stroke="#334155"
          strokeWidth="2"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        />
        
        {/* Calendar header */}
        <motion.rect
          x="30"
          y="40"
          width="140"
          height="35"
          rx="12"
          fill="url(#calGrad)"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1 }}
        />
        
        {/* Header text */}
        <text x="100" y="63" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">
          January 2025
        </text>
        
        {/* Calendar grid */}
        {[0, 1, 2, 3, 4].map((row) => (
          [0, 1, 2, 3, 4, 5, 6].map((col) => {
            const day = row * 7 + col + 1
            if (day > 31) return null
            const isHighlighted = [8, 9, 10, 15, 22].includes(day)
            return (
              <motion.g key={`${row}-${col}`}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 + (row * 7 + col) * 0.02 }}
              >
                <rect
                  x={38 + col * 18}
                  y={85 + row * 17}
                  width="14"
                  height="14"
                  rx="3"
                  fill={isHighlighted ? '#10b981' : 'transparent'}
                  opacity={isHighlighted ? 0.3 : 1}
                />
                <text
                  x={45 + col * 18}
                  y={95 + row * 17}
                  textAnchor="middle"
                  fill={isHighlighted ? '#10b981' : '#94a3b8'}
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
          initial={{ x: 20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          <rect x="130" y="25" width="50" height="24" rx="12" fill="#10b981" />
          <text x="155" y="41" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">
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
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
          <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f43f5e" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
        </defs>
        
        {/* Grid lines */}
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1="30"
            y1={40 + i * 35}
            x2="180"
            y2={40 + i * 35}
            stroke="#334155"
            strokeWidth="1"
            opacity="0.5"
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
            transition={{ delay: 0.1 * i, duration: 0.6, ease: "easeOut" }}
          />
        ))}
        
        {/* Trend line */}
        <motion.path
          d="M 43 140 L 65 110 L 87 125 L 109 85 L 131 105 L 153 65 L 175 90"
          stroke="url(#lineGrad)"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.5, duration: 1 }}
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
            r="4"
            fill="#f43f5e"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.5 + i * 0.1 }}
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
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>
          <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1e293b" />
            <stop offset="100%" stopColor="#0f172a" />
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
          stroke="#334155"
          strokeWidth="2"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        />
        
        {/* Card chip */}
        <motion.rect
          x="40"
          y="70"
          width="30"
          height="22"
          rx="4"
          fill="#f59e0b"
          opacity="0.8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.8 }}
          transition={{ delay: 0.3 }}
        />
        
        {/* Card number */}
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <text x="40" y="115" fill="#64748b" fontSize="10" fontFamily="monospace">
            •••• •••• •••• 4521
          </text>
        </motion.g>
        
        {/* Amount */}
        <motion.text
          x="40"
          y="138"
          fill="#10b981"
          fontSize="18"
          fontWeight="bold"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
        >
          $12,450.00
        </motion.text>
        
        {/* Floating coins */}
        {[
          { x: 160, y: 40, delay: 0.6 },
          { x: 175, y: 55, delay: 0.7 },
          { x: 150, y: 25, delay: 0.8 },
        ].map((coin, i) => (
          <motion.g
            key={i}
            initial={{ y: coin.y + 20, opacity: 0 }}
            animate={{ y: coin.y, opacity: 1 }}
            transition={{ delay: coin.delay, duration: 0.5 }}
          >
            <circle cx={coin.x} cy={coin.y} r="12" fill="url(#moneyGrad)" />
            <text x={coin.x} y={coin.y + 4} textAnchor="middle" fill="#fff" fontSize="10" fontWeight="bold">
              $
            </text>
          </motion.g>
        ))}
        
        {/* Success checkmark */}
        <motion.g
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.9, type: "spring" }}
        >
          <circle cx="160" cy="120" r="15" fill="#10b981" />
          <path
            d="M 152 120 L 157 125 L 168 114"
            stroke="white"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.g>
      </svg>
    </div>
  )
}

// Animated Workflow Connector
export function WorkflowConnector({ direction = 'right' }: { direction?: 'right' | 'down' }) {
  return (
    <motion.div
      className={`flex ${direction === 'down' ? 'flex-col items-center' : 'items-center'}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {direction === 'right' ? (
        <svg width="80" height="30" viewBox="0 0 80 30">
          <motion.path
            d="M 0 15 L 60 15"
            stroke="#6366f1"
            strokeWidth="2"
            strokeDasharray="6 4"
            fill="none"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1, repeat: Infinity, repeatDelay: 1 }}
          />
          <motion.polygon
            points="60,10 75,15 60,20"
            fill="#6366f1"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
          />
        </svg>
      ) : (
        <svg width="30" height="60" viewBox="0 0 30 60">
          <motion.path
            d="M 15 0 L 15 40"
            stroke="#6366f1"
            strokeWidth="2"
            strokeDasharray="6 4"
            fill="none"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1, repeat: Infinity, repeatDelay: 1 }}
          />
          <motion.polygon
            points="10,40 15,55 20,40"
            fill="#6366f1"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
          />
        </svg>
      )}
    </motion.div>
  )
}
