'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle, Loader2 } from 'lucide-react'
import { ensureAttributionState, trackMarketingVisit } from '@/lib/marketingAttribution'
import { idpUrl } from '@/app/site-config'

interface BookDemoModalProps {
    isOpen: boolean
    onClose: () => void
}

export default function BookDemoModal({ isOpen, onClose }: BookDemoModalProps) {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        company: '',
        role: '',
        message: ''
    })
    const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setStatus('submitting')

        try {
            const attribution = ensureAttributionState()
            const res = await fetch('/api/book-demo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formData,
                    visitorId: attribution.visitorId,
                    sessionId: attribution.sessionId,
                    attributionToken: attribution.attributionToken,
                    utm_source: attribution.utmSource,
                    utm_medium: attribution.utmMedium,
                    utm_campaign: attribution.utmCampaign,
                    utm_term: attribution.utmTerm,
                    utm_content: attribution.utmContent,
                    landingPage: attribution.landingPage,
                    referrer: attribution.referrer,
                })
            })

            if (res.ok) {
                trackMarketingVisit(idpUrl('/api/public/marketing/visit'), {
                    eventType: 'demo_submit',
                    sourceApp: 'marketing-site',
                    source: 'marketing-site',
                    channel: 'web',
                    pageUrl: window.location.href,
                    path: window.location.pathname,
                    referrer: document.referrer,
                    eventLabel: 'book-demo-modal',
                }).catch(() => {})
                setStatus('success')
                setTimeout(() => {
                    onClose()
                    setStatus('idle')
                    setFormData({ name: '', email: '', company: '', role: '', message: '' })
                }, 3000)
            } else {
                setStatus('error')
            }
        } catch (error) {
            setStatus('error')
        }
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
                    />

                    {/* Modal */}
                    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 20 }}
                            className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/20 bg-[#0b0b11] p-8 shadow-2xl ring-1 ring-white/10"
                        >
                            {/* Close Button */}
                            <button
                                onClick={onClose}
                                className="absolute right-6 top-6 text-zinc-500 transition hover:text-white"
                            >
                                <X size={20} />
                            </button>

                            {status === 'success' ? (
                                <div className="flex flex-col items-center justify-center py-12 text-center">
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-500/20 text-violet-400"
                                    >
                                        <CheckCircle size={32} />
                                    </motion.div>
                                    <h3 className="mt-6 text-2xl font-display text-white">Request Sent!</h3>
                                    <p className="mt-2 text-zinc-400">We'll be in touch with you shortly.</p>
                                </div>
                            ) : (
                                <>
                                    <div className="mb-8">
                                        <h2 className="text-2xl font-display text-white">Book a Demo</h2>
                                        <p className="mt-2 text-sm text-zinc-400">
                                            See how Seemplify orchestrates your entire workforce stack.
                                        </p>
                                    </div>

                                    <form onSubmit={handleSubmit} className="space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-medium text-zinc-400">Name</label>
                                                <input
                                                    required
                                                    type="text"
                                                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white transition focus:border-violet-500/50 focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                                                    placeholder="Jane Doe"
                                                    value={formData.name}
                                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-medium text-zinc-400">Company</label>
                                                <input
                                                    type="text"
                                                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white transition focus:border-violet-500/50 focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                                                    placeholder="Acme Inc."
                                                    value={formData.company}
                                                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-zinc-400">Work Email</label>
                                            <input
                                                required
                                                type="email"
                                                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white transition focus:border-violet-500/50 focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                                                placeholder="jane@company.com"
                                                value={formData.email}
                                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                            />
                                        </div>

                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-zinc-400">Role</label>
                                            <input
                                                type="text"
                                                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white transition focus:border-violet-500/50 focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                                                placeholder="HR Manager, CTO, etc."
                                                value={formData.role}
                                                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                            />
                                        </div>

                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-zinc-400">Message (Optional)</label>
                                            <textarea
                                                rows={3}
                                                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white transition focus:border-violet-500/50 focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                                                placeholder="Tell us about your needs..."
                                                value={formData.message}
                                                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                                            />
                                        </div>

                                        <div className="pt-2">
                                            <button
                                                type="submit"
                                                disabled={status === 'submitting'}
                                                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3 text-sm font-medium text-white shadow-lg shadow-violet-500/20 transition hover:shadow-violet-500/30 disabled:opacity-70"
                                            >
                                                {status === 'submitting' ? <Loader2 className="animate-spin" size={18} /> : 'Book Demo'}
                                            </button>
                                        </div>
                                    </form>
                                </>
                            )}
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    )
}
