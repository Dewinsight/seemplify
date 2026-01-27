'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { motion } from 'framer-motion';
import {
    ArrowRight,
    Shield,
    Sparkles,
    LayoutGrid,
    Calendar,
    Clock,
    Users,
    BarChart,
    CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LoginPage() {
    const router = useRouter();
    // Using custom hook logic or standard search params if useSearchParams might be buggy in some next versions without Suspense, 
    // but standard hook is fine here.
    const searchParams = useSearchParams();
    const { isAuthenticated, user } = useAuth(); // Assuming login method exists and redirects to API
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
    const [isProcessing, setIsProcessing] = useState(false);

    const error = searchParams.get('error');

    // Mouse tracking for interactive background
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            setMousePosition({ x: e.clientX, y: e.clientY });
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, []);

    // Handle immediate redirect if already logged in
    useEffect(() => {
        // If we have a user, redirect to dashboard or the redirect URL
        if (user) {
            const redirectUrl = searchParams.get('redirect') || '/dashboard';
            router.push(redirectUrl);
        }
    }, [user, router, searchParams]);

    const handleLogin = () => {
        setIsProcessing(true);
        // Get API URL - use production if on production domain
        let apiUrl = process.env.NEXT_PUBLIC_API_URL;
        if (typeof window !== 'undefined' && window.location.hostname.includes('seemplifyai.com')) {
            apiUrl = 'https://api-time.seemplifyai.com/api';
        }
        if (!apiUrl) {
            apiUrl = 'http://localhost:5010/api'; // Fallback for local dev only
        }
        // Redirect to backend login endpoint which handles OIDC
        window.location.href = `${apiUrl}/auth/login`;
    };

    if (isProcessing) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 relative overflow-hidden flex items-center justify-center">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none"></div>
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-teal-500/20 rounded-full blur-3xl animate-pulse pointer-events-none"></div>
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl animate-pulse delay-1000 pointer-events-none"></div>

                <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5 }}
                    className="relative z-10 text-center"
                >
                    <div className="bg-zinc-900/50 backdrop-blur-2xl border border-white/10 rounded-2xl p-12 shadow-2xl">
                        <motion.div
                            animate={{
                                rotate: 360,
                            }}
                            transition={{
                                duration: 2,
                                repeat: Infinity,
                                ease: "linear"
                            }}
                            className="w-24 h-24 mx-auto mb-6 relative"
                        >
                            <div className="absolute inset-0 bg-gradient-to-tr from-teal-500 to-cyan-500 rounded-full opacity-20 blur-xl"></div>
                            <div className="absolute inset-2 border-4 border-transparent border-t-teal-400 border-r-cyan-400 rounded-full"></div>
                        </motion.div>

                        <motion.h2
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="text-2xl font-bold text-white mb-3"
                        >
                            Connecting to IDP
                        </motion.h2>

                        <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.4 }}
                            className="text-zinc-400 text-sm"
                        >
                            Securely logging you into Time & Attendance...
                        </motion.p>

                        <motion.div
                            initial={{ scaleX: 0 }}
                            animate={{ scaleX: 1 }}
                            transition={{ delay: 0.6, duration: 1.5 }}
                            className="mt-6 h-1 bg-gradient-to-r from-teal-500 to-cyan-500 rounded-full origin-left"
                        ></motion.div>
                    </div>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="h-screen bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 relative overflow-hidden">
            {/* Animated Background Elements */}
            <div
                className="absolute inset-0 opacity-30"
                style={{
                    background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(20, 184, 166, 0.15), transparent 40%)`
                }}
            />

            {/* Floating Orbs */}
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-teal-500/20 rounded-full blur-3xl animate-pulse"></div>
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
            <div className="absolute top-3/4 left-1/3 w-64 h-64 bg-emerald-500/20 rounded-full blur-3xl animate-pulse delay-2000"></div>

            {/* Grid Pattern Overlay */}
            <div
                className="absolute inset-0 opacity-10"
                style={{
                    backgroundImage: `
            linear-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px)
          `,
                    backgroundSize: '50px 50px'
                }}
            />

            <div className="relative z-10 flex h-screen">
                {/* Left Side - Brand & Features */}
                <div className="hidden lg:flex lg:w-1/2 flex-col justify-center p-6 lg:p-8 xl:p-12 2xl:p-16">
                    {/* Logo and Brand */}
                    <div className="mb-6 lg:mb-8 xl:mb-12">
                        <div className="flex items-center mb-6">
                            <div className="relative">
                                <div className="w-10 h-10 lg:w-12 lg:h-12 xl:w-14 xl:h-14 bg-gradient-to-br from-teal-400 to-cyan-500 rounded-xl flex items-center justify-center shadow-2xl shadow-teal-500/20">
                                    <Clock className="w-6 h-6 lg:w-7 lg:h-7 xl:w-8 xl:h-8 text-white" />
                                </div>
                                <div className="absolute -top-1 -right-1 w-3 h-3 lg:w-4 lg:h-4 bg-emerald-400 rounded-full border-2 border-zinc-900 animate-pulse"></div>
                            </div>
                            <div className="ml-3 lg:ml-4">
                                <h1 className="text-xl lg:text-2xl xl:text-3xl font-bold text-white">Time & Attendance</h1>
                                <p className="text-zinc-400 text-xs lg:text-sm">Smart Workforce Management</p>
                            </div>
                        </div>

                        <div className="max-w-md">
                            <h2 className="text-2xl lg:text-3xl xl:text-4xl 2xl:text-5xl font-bold text-white mb-3 lg:mb-4 leading-tight">
                                Track time
                                <span className="block bg-gradient-to-r from-teal-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                                    effortlessly
                                </span>
                            </h2>
                            <p className="text-zinc-400 text-sm lg:text-base xl:text-lg leading-relaxed">
                                Streamline your workforce management with intelligent clocking, timesheets, and reporting.
                            </p>
                        </div>
                    </div>

                    {/* Feature Cards */}
                    <div className="space-y-2 lg:space-y-3 xl:space-y-4">
                        {[
                            {
                                icon: <Clock className="w-5 h-5" />,
                                title: "Smart Clocking",
                                description: "Seamless check-ins with location tracking"
                            },
                            {
                                icon: <Calendar className="w-5 h-5" />,
                                title: "Digital Timesheets",
                                description: "Automated week-view and submission flows"
                            },
                            {
                                icon: <BarChart className="w-5 h-5" />,
                                title: "Real-time Insights",
                                description: "Monitor attendance and overtime instantly"
                            }
                        ].map((feature, index) => (
                            <div
                                key={index}
                                className="flex items-center p-2 lg:p-3 xl:p-4 bg-zinc-800/30 backdrop-blur-sm rounded-lg lg:rounded-xl border border-white/5 hover:bg-zinc-800/50 transition-all duration-300 group"
                            >
                                <div className="flex-shrink-0 w-8 h-8 lg:w-9 lg:h-9 xl:w-10 xl:h-10 bg-gradient-to-br from-teal-400 to-cyan-500 rounded-lg flex items-center justify-center text-white group-hover:scale-110 transition-transform duration-300 shadow-lg shadow-teal-500/10">
                                    {feature.icon}
                                </div>
                                <div className="ml-2 lg:ml-3 xl:ml-4">
                                    <h3 className="text-white font-semibold text-sm lg:text-base">{feature.title}</h3>
                                    <p className="text-zinc-400 text-xs lg:text-sm">{feature.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right Side - Login Form */}
                <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
                    <div className="w-full max-w-md">
                        {/* Mobile Logo */}
                        <div className="lg:hidden flex justify-center mb-8">
                            <div className="w-14 h-14 bg-gradient-to-br from-teal-400 to-cyan-500 rounded-xl flex items-center justify-center shadow-2xl">
                                <Clock className="w-8 h-8 text-white" />
                            </div>
                        </div>

                        {/* Enhanced Login Card */}
                        <motion.div
                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{ duration: 0.5, type: "spring", stiffness: 100 }}
                        >
                            {/* Card Component Inline */}
                            <div className="bg-zinc-900/50 backdrop-blur-2xl border border-white/10 shadow-2xl overflow-hidden relative rounded-xl">
                                {/* Subtle Animated Border */}
                                <div className="absolute inset-0 bg-gradient-to-r from-teal-500/10 via-cyan-500/10 to-emerald-500/10 rounded-lg animate-pulse opacity-30 pointer-events-none"></div>

                                <div className="p-6 space-y-1 text-center pb-6 relative z-10">
                                    <motion.div
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: 0.2, duration: 0.5 }}
                                    >
                                        <div className="text-2xl font-bold text-white flex items-center justify-center gap-2">
                                            Welcome back
                                            <motion.div
                                                animate={{ rotate: [0, 10, 0] }}
                                                transition={{ duration: 2, repeat: Infinity }}
                                            >
                                                <Sparkles className="w-5 h-5 text-teal-400" />
                                            </motion.div>
                                        </div>
                                    </motion.div>
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.4, duration: 0.5 }}
                                    >
                                        <div className="text-zinc-400 text-base mt-2">
                                            Sign in to Time & Attendance
                                        </div>
                                    </motion.div>
                                </div>

                                <div className="relative z-10 p-6 pt-0 space-y-6">
                                    {/* Error Display */}
                                    {error && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="bg-red-500/10 border border-red-500/20 text-red-200 px-4 py-3 rounded-lg text-sm flex items-center gap-2"
                                        >
                                            <Shield className="h-4 w-4 text-red-400" />
                                            {error}
                                        </motion.div>
                                    )}

                                    {/* IDP Login Description */}
                                    <motion.div
                                        className="text-center space-y-3"
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: 0.6, duration: 0.5 }}
                                    >
                                        <p className="text-zinc-500 text-sm">
                                            Use your Seemplify Identity to access the workforce portal
                                        </p>
                                    </motion.div>

                                    <motion.div
                                        className="w-full"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: 0.8, duration: 0.5 }}
                                    >
                                        <motion.div
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.98 }}
                                            transition={{ type: "spring", stiffness: 400 }}
                                        >
                                            <button
                                                type="button"
                                                onClick={handleLogin}
                                                className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-400 hover:to-cyan-500 text-white font-semibold h-12 rounded-xl transition-all duration-300 shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 border-0 focus:ring-2 focus:ring-teal-500/50 focus:outline-none flex items-center justify-center space-x-3"
                                            >
                                                <span>Login with Identity Provider</span>
                                                <motion.div
                                                    animate={{ x: [0, 4, 0] }}
                                                    transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 1 }}
                                                >
                                                    <ArrowRight className="w-5 h-5" />
                                                </motion.div>
                                            </button>
                                        </motion.div>
                                    </motion.div>
                                </div>
                            </div>
                        </motion.div>

                        {/* App Hub (View All Apps) */}
                        <motion.div
                            className="mt-4 sm:mt-5 lg:mt-7"
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 1.35, duration: 0.5 }}
                        >
                            <motion.a
                                whileHover={{ scale: 1.01 }}
                                whileTap={{ scale: 0.99 }}
                                href={typeof window !== 'undefined' && window.location.hostname.includes('seemplifyai.com') 
                                    ? 'https://auth.seemplifyai.com' 
                                    : (process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000')}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-zinc-900/50 px-4 py-3 text-left text-white shadow-lg transition-all hover:border-white/20 hover:bg-zinc-800/50 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                            >
                                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500/20 to-cyan-500/20 ring-1 ring-white/10">
                                    <LayoutGrid className="h-5 w-5 text-teal-400" />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-semibold leading-5 text-zinc-200 group-hover:text-white transition-colors">Open App Hub</span>
                                    <span className="block truncate text-xs text-zinc-500 group-hover:text-zinc-400 transition-colors">View all Seemplify apps and tools</span>
                                </span>
                                <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-zinc-400" />
                            </motion.a>
                        </motion.div>

                        {/* Security Notice */}
                        <motion.div
                            className="mt-3 sm:mt-4 lg:mt-6 flex items-center justify-center space-x-2 text-zinc-600 text-xs"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 1.6, duration: 0.5 }}
                        >
                            <motion.div
                                animate={{
                                    scale: [1, 1.1, 1],
                                    rotate: [0, 5, 0]
                                }}
                                transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                            >
                                <Shield className="w-3 h-3 sm:w-4 sm:h-4" />
                            </motion.div>
                            <motion.span
                                className="text-center"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 1.8, duration: 0.5 }}
                            >
                                Your data is protected with enterprise-grade security
                            </motion.span>
                        </motion.div>
                    </div>
                </div>
            </div>
        </div>
    );
}
