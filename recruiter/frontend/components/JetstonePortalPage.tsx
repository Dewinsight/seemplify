'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, Shield, Users, FileCheck, Calendar,
  Briefcase, Star, Menu, X, MapPin, Phone, Mail,
  Award, ChevronRight, Building2, ClipboardList,
  Loader2, Clock, Search
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import ScrollReveal from '@/components/animations/ScrollReveal';
import GradientMesh from '@/components/backgrounds/GradientMesh';
import StickyHeader from '@/components/StickyHeader';
import ScrollProgress from '@/components/ui/ScrollProgress';
import BackToTop from '@/components/ui/BackToTop';
import { apiRequest } from '@/services/apiConfig';

interface Job {
  _id: string;
  title: string;
  department?: { _id: string; name: string } | string;
  location: string;
  type: string;
  level?: string;
  description?: string;
  salary?: { min?: number; max?: number; currency?: string };
  remote: boolean;
  openings?: number;
  createdAt: string;
  organization: { _id: string; name: string; logo?: string };
}

const btnPrimary = 'bg-gradient-to-r from-green-700 to-green-900 hover:from-green-800 hover:to-green-950 text-white border-0 shadow-lg';
const btnOutline = 'bg-white/50 border border-green-300 text-green-900 hover:bg-white/80';
const sealRing = 'ring-4 ring-green-200/60 shadow-xl';

export default function JetstonePortalPage() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Live jobs from Akwa Ibom org
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobTotal, setJobTotal] = useState(0);
  const [jobPage, setJobPage] = useState(1);
  const [jobPages, setJobPages] = useState(1);
  const [jobSearch, setJobSearch] = useState('');
  const [jobSearchInput, setJobSearchInput] = useState('');

  useEffect(() => {
    const fetchAkwaIbomJobs = async () => {
      setJobsLoading(true);
      try {
        const params = new URLSearchParams();
        params.append('orgName', 'akwa ibom');
        params.append('page', jobPage.toString());
        params.append('limit', '9');
        if (jobSearch) params.append('search', jobSearch);
        const res = await apiRequest(`/api/jobs/public?${params}`);
        if (!res.ok) throw new Error('fetch failed');
        const data = await res.json();
        setJobs(data.jobs ?? []);
        setJobTotal(data.pagination?.total ?? 0);
        setJobPages(data.pagination?.pages ?? 1);
      } catch {
        setJobs([]);
      } finally {
        setJobsLoading(false);
      }
    };
    fetchAkwaIbomJobs();
  }, [jobPage, jobSearch]);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => {
      setJobSearch(jobSearchInput);
      setJobPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [jobSearchInput]);

  const getRelativeTime = (date: string) => {
    const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return `${Math.floor(days / 30)} months ago`;
  };

  const navLinks = [
    { href: '#about', label: 'About' },
    { href: '#vacancies', label: 'Vacancies' },
    { href: '#how-to-apply', label: 'How to Apply' },
    { href: '#values', label: 'Our Values' },
    { href: '#contact', label: 'Contact' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-amber-50 to-white text-slate-900 overflow-x-hidden relative jetstone-light-theme">
      <ScrollProgress />
      <GradientMesh />
      <BackToTop />

      {/* ── Header ── */}
      <StickyHeader>
        <div className="container mx-auto px-4 flex justify-between items-center">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full overflow-hidden bg-white flex-shrink-0 ${sealRing}`}>
              <Image src="/akwa-ibom-seal.png" alt="Akwa Ibom State" width={40} height={40} className="object-cover w-full h-full" />
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-bold text-green-900 leading-tight">Govt. of Akwa Ibom State</p>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-slate-500">Powered by</span>
                <Image src="/jetstone-logo.png" alt="Jetstone Education" width={64} height={14} className="object-contain h-3 w-auto" />
              </div>
            </div>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-6">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} className="text-sm font-medium text-slate-600 hover:text-green-800 transition-colors">
                {link.label}
              </a>
            ))}
          </nav>

          {/* Desktop Actions */}
          <div className="hidden md:flex gap-3">
            <Button
              variant="outline" size="sm" className={btnOutline}
              onClick={() => { const el = document.getElementById('vacancies'); el?.scrollIntoView({ behavior: 'smooth' }); }}
            >
              View Vacancies
            </Button>
          </div>

          {/* Mobile hamburger */}
          <button
            className="lg:hidden p-2 text-slate-700 hover:bg-green-100 rounded-lg"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden"
                onClick={() => setIsMobileMenuOpen(false)}
              />
              <motion.div
                initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-0 right-0 bottom-0 w-72 bg-white z-50 shadow-2xl border-l border-green-100"
              >
                <div className="flex justify-end p-4">
                  <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 hover:bg-green-50 rounded-lg">
                    <X className="w-5 h-5 text-slate-600" />
                  </button>
                </div>
                <nav className="px-6 space-y-2 pb-6">
                  {navLinks.map((link) => (
                    <a key={link.href} href={link.href}
                      className="flex items-center gap-2 py-3 text-slate-700 font-medium border-b border-green-50 hover:text-green-800"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      <ChevronRight className="w-4 h-4 text-green-500" />
                      {link.label}
                    </a>
                  ))}
                  <Button className={`w-full mt-6 ${btnPrimary}`} onClick={() => { setIsMobileMenuOpen(false); const el = document.getElementById('vacancies'); el?.scrollIntoView({ behavior: 'smooth' }); }}>
                    View Vacancies
                  </Button>
                </nav>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </StickyHeader>

      <div className="h-24" />

      {/* ── HERO ── */}
      <section id="hero" className="relative z-10 container mx-auto px-4 py-16 md:py-24 lg:py-28 flex flex-col lg:flex-row items-center gap-12">
        {/* Left: text */}
        <div className="lg:w-1/2 space-y-7">
          {/* State badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 bg-green-100 border border-green-200 rounded-full px-4 py-1.5"
          >
            <div className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0">
              <Image src="/akwa-ibom-seal.png" alt="" width={20} height={20} className="object-cover w-full h-full" />
            </div>
            <span className="text-green-800 text-xs font-semibold tracking-wide uppercase">Official Recruitment Portal</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1 }}
            className="text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-black leading-[1.08] tracking-tight text-slate-900"
          >
            Serve the{' '}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-green-700 via-amber-700 to-yellow-600">
              Land of Promise
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.2 }}
            className="text-lg md:text-xl text-slate-600 max-w-xl leading-relaxed"
          >
            The Government of Akwa Ibom State is committed to transparent, merit-based recruitment across all
            ministries, departments, and agencies. Explore opportunities to serve your state.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.3 }}
            className="flex flex-wrap gap-4"
          >
            <Button className={`h-13 px-8 text-base font-semibold ${btnPrimary}`} onClick={() => { const el = document.getElementById('vacancies'); el?.scrollIntoView({ behavior: 'smooth' }); }}>
              Browse Vacancies <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <Button variant="outline" className={`h-13 px-8 text-base font-semibold ${btnOutline}`} onClick={() => { const el = document.getElementById('how-to-apply'); el?.scrollIntoView({ behavior: 'smooth' }); }}>
              How to Apply
            </Button>
          </motion.div>

          {/* Quick stats */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
            className="flex flex-wrap gap-6 pt-2"
          >
            {[
              { label: 'State Agencies', value: '40+' },
              { label: 'Open Categories', value: '12' },
              { label: 'Equal Opportunity', value: '100%' },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-2xl font-black text-green-800">{s.value}</div>
                <div className="text-xs text-slate-500 font-medium">{s.label}</div>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Right: Governor's photo */}
        <motion.div
          className="lg:w-1/2 flex justify-center"
          initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.3 }}
        >
          <div className="relative max-w-md w-full">
            {/* Main image */}
            <div className="relative z-10 rounded-3xl overflow-hidden border-4 border-green-200 shadow-2xl">
              <Image
                src="/governor-umo-eno.png"
                alt="Governor Umo Eno — Akwa Ibom State"
                width={540}
                height={620}
                className="w-full object-cover object-top"
                priority
              />
              {/* Name overlay */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-green-950/90 to-transparent p-6">
                <p className="text-white font-black text-xl">His Excellency</p>
                <p className="text-amber-300 font-bold text-lg">Gov. Umo Eno</p>
                <p className="text-green-300 text-sm">Governor, Akwa Ibom State</p>
              </div>
            </div>

            {/* Floating seal */}
            <div className={`absolute -top-5 -right-5 w-20 h-20 rounded-full overflow-hidden bg-white ${sealRing} z-20`}>
              <Image src="/akwa-ibom-seal.png" alt="Akwa Ibom State Seal" width={80} height={80} className="object-cover w-full h-full" />
            </div>

            {/* Floating quote card */}
            <motion.div
              className="absolute -bottom-8 -left-6 bg-white border border-green-100 rounded-2xl shadow-xl p-4 max-w-[220px] z-20"
              initial={{ opacity: 0, y: 20, rotate: -3 }} animate={{ opacity: 1, y: 0, rotate: -3 }}
              transition={{ delay: 1, duration: 0.5 }}
            >
              <div className="flex gap-1 mb-2">
                {[...Array(5)].map((_, i) => <Star key={i} className="w-3 h-3 text-amber-400 fill-amber-400" />)}
              </div>
              <p className="text-xs text-slate-700 italic leading-relaxed">
                "A transparent and merit-driven Akwa Ibom for all."
              </p>
              <p className="text-[10px] text-green-700 font-semibold mt-1">— Gov. Umo Eno</p>
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* ── GOVERNOR'S MESSAGE ── */}
      <section id="about" className="relative z-10 py-20 md:py-28 bg-gradient-to-r from-green-900 via-green-800 to-green-900">
        <div className="container mx-auto px-4">
          <ScrollReveal>
            <div className="max-w-4xl mx-auto text-center">
              <div className="flex justify-center mb-6">
                <div className={`w-16 h-16 rounded-full overflow-hidden bg-white ${sealRing}`}>
                  <Image src="/akwa-ibom-seal.png" alt="" width={64} height={64} className="object-cover w-full h-full" />
                </div>
              </div>
              <div className="inline-flex items-center gap-2 bg-amber-400/20 border border-amber-400/30 rounded-full px-4 py-1.5 mb-6">
                <Award className="w-4 h-4 text-amber-300" />
                <span className="text-amber-200 text-xs font-semibold uppercase tracking-wide">Governor's Message</span>
              </div>
              <blockquote className="text-2xl md:text-3xl lg:text-4xl font-bold text-white leading-relaxed mb-8 italic">
                "We are building a state where every qualified Akwa Ibom citizen has a fair chance to serve
                and contribute to our collective progress. This portal is our commitment to that promise."
              </blockquote>
              <div className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-amber-400/50 shadow-lg">
                  <Image src="/governor-umo-eno.png" alt="Governor Umo Eno" width={48} height={48} className="object-cover object-top w-full h-full" />
                </div>
                <p className="text-amber-300 font-bold text-lg">His Excellency, Governor Umo Eno</p>
                <p className="text-green-300 text-sm">Executive Governor, Akwa Ibom State</p>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── VACANCIES / LIVE JOBS ── */}
      <section id="vacancies" className="relative z-10 container mx-auto px-4 py-20 md:py-28">
        <ScrollReveal>
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 bg-green-100 border border-green-200 rounded-full px-4 py-1.5 mb-5">
              <Briefcase className="w-4 h-4 text-green-700" />
              <span className="text-green-800 text-xs font-semibold uppercase tracking-wide">Open Opportunities</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-black text-slate-900 mb-4">
              Current{' '}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-green-700 to-amber-700">Vacancies</span>
            </h2>
            <p className="text-slate-500 text-lg max-w-2xl mx-auto">
              Live positions from Akwa Ibom State Government ministries, parastatals, and agencies.
              All recruitments follow merit-based selection with equal opportunity for all.
            </p>
          </div>
        </ScrollReveal>

        {/* Search bar */}
        <div className="max-w-xl mx-auto mb-8 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <Input
            placeholder="Search vacancies…"
            value={jobSearchInput}
            onChange={(e) => setJobSearchInput(e.target.value)}
            className="pl-10 h-11 bg-white border-slate-200 focus:border-green-400 shadow-sm"
          />
        </div>

        {/* Job count pill */}
        {!jobsLoading && (
          <p className="text-center text-sm text-slate-500 mb-8">
            {jobTotal === 0 ? 'No vacancies found' : `${jobTotal} open position${jobTotal !== 1 ? 's' : ''}`}
          </p>
        )}

        {/* Loading */}
        {jobsLoading && (
          <div className="flex justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-green-600" />
          </div>
        )}

        {/* Jobs grid */}
        {!jobsLoading && jobs.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {jobs.map((job, i) => (
              <ScrollReveal key={job._id} delay={i * 0.05}>
                <motion.div
                  className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:shadow-lg transition-all duration-300 group cursor-pointer flex flex-col h-full"
                  whileHover={{ y: -4 }}
                  onClick={() => router.push(`/public/jobs/${job._id}`)}
                >
                  {/* Header */}
                  <div className="flex items-start gap-3 mb-4">
                    {job.organization.logo ? (
                      <img src={job.organization.logo} alt={job.organization.name} className="w-11 h-11 rounded-xl object-cover border border-slate-100 flex-shrink-0" />
                    ) : (
                      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-green-600 to-emerald-500 flex items-center justify-center flex-shrink-0 shadow-md">
                        <Building2 className="w-5 h-5 text-white" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-slate-900 text-base leading-snug line-clamp-2 group-hover:text-green-800 transition-colors">
                        {job.title}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{job.organization.name}</p>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <Badge variant="outline" className="text-[11px] border-slate-200 text-slate-600 flex items-center gap-1">
                      <MapPin className="w-2.5 h-2.5" />
                      {job.remote ? 'Remote' : job.location || 'Akwa Ibom'}
                    </Badge>
                    {job.type && (
                      <Badge variant="outline" className="text-[11px] border-green-200 text-green-700">
                        {job.type}
                      </Badge>
                    )}
                    {job.level && (
                      <Badge variant="outline" className="text-[11px] border-amber-200 text-amber-700">
                        {job.level}
                      </Badge>
                    )}
                    {job.department && (
                      <Badge variant="outline" className="text-[11px] border-blue-200 text-blue-700 truncate max-w-[130px]">
                        {typeof job.department === 'string' ? job.department : job.department.name}
                      </Badge>
                    )}
                  </div>

                  {/* Description snippet */}
                  {job.description && (
                    <p className="text-slate-500 text-xs leading-relaxed line-clamp-2 mb-4 flex-1">{job.description}</p>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between mt-auto pt-3 border-t border-slate-50">
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />{getRelativeTime(job.createdAt)}
                    </span>
                    <span className="text-xs font-semibold text-green-700 flex items-center gap-0.5 group-hover:gap-1.5 transition-all">
                      Apply <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </motion.div>
              </ScrollReveal>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!jobsLoading && jobs.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-50 border border-green-100 flex items-center justify-center">
              <Briefcase className="w-8 h-8 text-green-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-700 mb-1">No vacancies found</h3>
            <p className="text-slate-500 text-sm">
              {jobSearch ? 'Try a different search term.' : 'New positions will appear here as they open.'}
            </p>
            {jobSearch && (
              <Button variant="outline" size="sm" className="mt-4 border-green-200 text-green-700" onClick={() => setJobSearchInput('')}>
                Clear Search
              </Button>
            )}
          </div>
        )}

        {/* Pagination */}
        {!jobsLoading && jobPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-10">
            <Button
              variant="outline" size="sm"
              disabled={jobPage === 1}
              onClick={() => setJobPage(p => Math.max(1, p - 1))}
              className="border-green-200 text-green-800 hover:bg-green-50"
            >
              Previous
            </Button>
            <span className="text-sm text-slate-500">Page {jobPage} of {jobPages}</span>
            <Button
              variant="outline" size="sm"
              disabled={jobPage === jobPages}
              onClick={() => setJobPage(p => Math.min(jobPages, p + 1))}
              className="border-green-200 text-green-800 hover:bg-green-50"
            >
              Next
            </Button>
          </div>
        )}

        <div className="text-center mt-10">
          <Button className={`h-12 px-10 text-base font-semibold ${btnPrimary}`} onClick={() => { const el = document.getElementById('how-to-apply'); el?.scrollIntoView({ behavior: 'smooth' }); }}>
            How to Apply <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </section>

      {/* ── HOW TO APPLY ── */}
      <section id="how-to-apply" className="relative z-10 bg-gradient-to-br from-slate-50 to-green-50/60 py-20 md:py-28 border-y border-green-100">
        <div className="container mx-auto px-4">
          <ScrollReveal>
            <div className="text-center mb-14">
              <div className="inline-flex items-center gap-2 bg-amber-100 border border-amber-200 rounded-full px-4 py-1.5 mb-5">
                <ClipboardList className="w-4 h-4 text-amber-700" />
                <span className="text-amber-800 text-xs font-semibold uppercase tracking-wide">Application Process</span>
              </div>
              <h2 className="text-3xl md:text-5xl font-black text-slate-900 mb-4">
                How to{' '}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-amber-600 to-green-700">Apply</span>
              </h2>
              <p className="text-slate-500 text-lg max-w-2xl mx-auto">
                Our streamlined process ensures every applicant is treated fairly and efficiently.
              </p>
            </div>
          </ScrollReveal>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 relative">
            {/* Connector line (desktop) */}
            <div className="hidden lg:block absolute top-14 left-[12.5%] right-[12.5%] h-0.5 bg-gradient-to-r from-green-200 via-amber-200 to-green-200 z-0" />

            {[
              { step: '01', title: 'Create Account', desc: 'Register on the portal with your NIN and email address.', icon: <UserCheck className="w-7 h-7" />, color: 'from-green-600 to-emerald-500' },
              { step: '02', title: 'Browse Vacancies', desc: 'Search open positions by ministry, location, or qualification.', icon: <Briefcase className="w-7 h-7" />, color: 'from-amber-500 to-orange-500' },
              { step: '03', title: 'Submit Application', desc: 'Complete your profile, upload credentials, and apply online.', icon: <FileCheck className="w-7 h-7" />, color: 'from-blue-500 to-indigo-500' },
              { step: '04', title: 'AI Screening & Interview', desc: 'Our AI ranks applications; shortlisted candidates are invited for interview.', icon: <Calendar className="w-7 h-7" />, color: 'from-purple-500 to-pink-500' },
            ].map((step, i) => (
              <ScrollReveal key={i} delay={i * 0.1}>
                <div className="relative z-10 flex flex-col items-center text-center">
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center text-white shadow-xl mb-4`}>
                    {step.icon}
                  </div>
                  <span className="text-xs font-black text-slate-300 mb-1 tracking-widest">STEP {step.step}</span>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">{step.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{step.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── VALUES ── */}
      <section id="values" className="relative z-10 container mx-auto px-4 py-20 md:py-28">
        <ScrollReveal>
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-green-100 border border-green-200 rounded-full px-4 py-1.5 mb-5">
              <Star className="w-4 h-4 text-green-700" />
              <span className="text-green-800 text-xs font-semibold uppercase tracking-wide">Our Commitment</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-black text-slate-900 mb-4">
              Built on{' '}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-green-700 to-amber-700">Integrity</span>
            </h2>
            <p className="text-slate-500 text-lg max-w-2xl mx-auto">
              Every recruitment process under the Akwa Ibom State Government is guided by these core principles.
            </p>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              icon: <Shield className="w-8 h-8" />,
              title: 'Transparency',
              desc: 'All selection criteria, timelines, and results are published openly. No hidden processes or closed-door decisions.',
              color: 'from-green-700 to-emerald-600',
              bg: 'from-green-50 to-emerald-50',
              border: 'border-green-100',
            },
            {
              icon: <Award className="w-8 h-8" />,
              title: 'Merit-Based Selection',
              desc: 'Candidates are assessed solely on qualifications, skills, and competency. Background, connections, or patronage play no role.',
              color: 'from-amber-600 to-orange-500',
              bg: 'from-amber-50 to-orange-50',
              border: 'border-amber-100',
            },
            {
              icon: <Users className="w-8 h-8" />,
              title: 'Equal Opportunity',
              desc: 'Applications are welcome from all qualified residents regardless of gender, religion, local government, or disability status.',
              color: 'from-blue-600 to-indigo-500',
              bg: 'from-blue-50 to-indigo-50',
              border: 'border-blue-100',
            },
          ].map((v, i) => (
            <ScrollReveal key={i} delay={i * 0.1}>
              <div className={`bg-gradient-to-br ${v.bg} border ${v.border} rounded-2xl p-8 h-full`}>
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${v.color} flex items-center justify-center text-white shadow-lg mb-5`}>
                  {v.icon}
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">{v.title}</h3>
                <p className="text-slate-600 leading-relaxed">{v.desc}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="relative z-10 py-20 bg-gradient-to-r from-green-900 via-green-800 to-green-900">
        <div className="container mx-auto px-4">
          <ScrollReveal>
            <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
              <div className="flex items-center gap-6">
                <div className={`w-16 h-16 rounded-full overflow-hidden bg-white flex-shrink-0 ${sealRing}`}>
                  <Image src="/akwa-ibom-seal.png" alt="Akwa Ibom State" width={64} height={64} className="object-cover w-full h-full" />
                </div>
                <div>
                  <h2 className="text-2xl md:text-3xl font-black text-white mb-2">
                    Ready to Serve Akwa Ibom State?
                  </h2>
                  <p className="text-green-200 text-base md:text-lg">
                    Browse open vacancies and submit your application directly online — no account needed.
                  </p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 flex-shrink-0">
                <Button
                  className="bg-amber-400 hover:bg-amber-300 text-green-950 border-0 font-bold h-12 px-8 text-base shadow-lg"
                  onClick={() => { const el = document.getElementById('vacancies'); el?.scrollIntoView({ behavior: 'smooth' }); }}
                >
                  Browse Vacancies <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
                <Button
                  variant="outline"
                  className="border-white/40 text-white hover:bg-white/10 h-12 px-8 text-base"
                  onClick={() => { const el = document.getElementById('how-to-apply'); el?.scrollIntoView({ behavior: 'smooth' }); }}
                >
                  How to Apply
                </Button>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── CONTACT ── */}
      <section id="contact" className="relative z-10 container mx-auto px-4 py-20">
        <ScrollReveal>
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-3">Contact & Support</h2>
            <p className="text-slate-500 text-lg">Reach the Recruitment Services team for assistance.</p>
          </div>
        </ScrollReveal>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
          {[
            { icon: <MapPin className="w-6 h-6 text-green-700" />, title: 'Address', detail: 'Government House, Uyo, Akwa Ibom State, Nigeria' },
            { icon: <Phone className="w-6 h-6 text-green-700" />, title: 'Phone', detail: '+234 (0) 800 AKWA IBOM' },
            { icon: <Mail className="w-6 h-6 text-green-700" />, title: 'Email', detail: 'recruitment@akwaibomstate.gov.ng' },
          ].map((c, i) => (
            <div key={i} className="flex flex-col items-center text-center bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
              <div className="w-12 h-12 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center mb-3">
                {c.icon}
              </div>
              <p className="font-semibold text-slate-800 mb-1">{c.title}</p>
              <p className="text-slate-500 text-sm">{c.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="relative z-10 bg-green-950 text-white py-12 mt-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full overflow-hidden bg-white ring-2 ring-amber-400/50">
                <Image src="/akwa-ibom-seal.png" alt="" width={48} height={48} className="object-cover w-full h-full" />
              </div>
              <div>
                <p className="font-bold text-amber-300">Government of Akwa Ibom State</p>
                <p className="text-green-400 text-xs">The Land of Promise · Nigeria</p>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-6 text-sm">
              <Link href="/public/jobs" className="text-green-300 hover:text-white transition-colors">Browse Jobs</Link>
              <Link href="/privacy" className="text-green-300 hover:text-white transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="text-green-300 hover:text-white transition-colors">Terms of Use</Link>
            </div>

            <div className="flex items-center gap-2 text-xs text-green-400">
              <span>Powered by</span>
              <Image src="/jetstone-logo.png" alt="Jetstone Education" width={80} height={18} className="object-contain h-4 w-auto brightness-200 opacity-70" />
            </div>
          </div>

          <div className="border-t border-green-800/60 mt-8 pt-6 text-center">
            <p className="text-green-400 text-xs">
              © {new Date().getFullYear()} Government of Akwa Ibom State. Powered by Jetstone Education. All rights reserved.
            </p>
            <p className="text-green-600 text-xs mt-1">
              This is the official recruitment portal of the Akwa Ibom State Government. All applications are subject to verification.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
