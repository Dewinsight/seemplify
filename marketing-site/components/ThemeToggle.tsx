'use client'

import { useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor } from 'lucide-react'
import { motion } from 'framer-motion'

export default function ThemeToggle() {
    const [mounted, setMounted] = useState(false)
    const { theme, setTheme } = useTheme()

    useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) {
        return <div className="w-[102px] h-9 rounded-full bg-zinc-200 dark:bg-white/5 animate-pulse" />
    }

    const tabs = [
        { id: 'light', icon: Sun },
        { id: 'system', icon: Monitor },
        { id: 'dark', icon: Moon },
    ]

    return (
        <div className="relative flex p-1 rounded-full bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 backdrop-blur-md">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    onClick={() => setTheme(tab.id)}
                    className="relative z-10 p-1.5 rounded-full text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors duration-200"
                >
                    {theme === tab.id && (
                        <motion.div
                            layoutId="theme-active"
                            className="absolute inset-0 bg-white dark:bg-white/10 rounded-full shadow-sm"
                            transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                        />
                    )}
                    <tab.icon size={14} className="relative z-10" />
                </button>
            ))}
        </div>
    )
}
