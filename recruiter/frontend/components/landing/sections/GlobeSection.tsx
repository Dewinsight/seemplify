'use client';

import { motion } from 'framer-motion';
import { Clock, Globe2 } from 'lucide-react';
import HiringGlobe from '@/components/landing/globe/HiringGlobe';
import BorderBeam from '@/components/landing/motion/BorderBeam';
import { CalendarIcon, UsersIcon, ZapIcon } from '@/components/landing/icons/AnimatedIcons';

// 13:00 UTC — the same instant in three places a Lagos-based team actually schedules across.
const TIMES = [
  { city: 'Lagos', time: '14:00', zone: 'WAT' },
  { city: 'New York', time: '09:00', zone: 'EDT' },
  { city: 'Nairobi', time: '16:00', zone: 'EAT' },
];

const POINTS = [
  {
    Icon: CalendarIcon,
    title: 'One slot, every calendar',
    body: 'Candidates and interviewers see the same time in their own zone; reminders go out in theirs.',
  },
  {
    Icon: UsersIcon,
    title: 'Panels across offices',
    body: 'Pull a hiring manager in London and an engineer in Nairobi into the same loop without the email thread.',
  },
  {
    Icon: ZapIcon,
    title: 'No-show recovery',
    body: 'When a slot slips, the next best window is offered automatically — no recruiter back-and-forth.',
  },
];

export default function GlobeSection() {
  return (
    <section id="global-hiring" className="relative z-10 container mx-auto px-4 py-20 md:py-28">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-10% 0px' }}
          transition={{ duration: 0.7 }}
        >
          <span className="mb-4 inline-flex items-center rounded-full bg-cyan-500/10 px-3 py-1 text-sm font-medium text-cyan-300">
            <Globe2 className="mr-2 h-4 w-4" />
            Interviews across time zones
          </span>
          <h2 className="mb-6 text-3xl font-bold md:text-5xl">
            Schedule around the world,{' '}
            <span className="bg-gradient-to-r from-cyan-300 to-purple-400 bg-clip-text text-transparent">
              not around the clock
            </span>
          </h2>
          <p className="mb-10 text-lg text-slate-300">
            Coordinate interviews between candidates and team members across multiple time zones, with calendar
            integration and automated reminders that respect where everyone actually is.
          </p>

          <div className="space-y-6">
            {POINTS.map(({ Icon, title, body }) => (
              <motion.div
                key={title}
                className="flex items-start"
                initial="idle"
                animate="idle"
                whileHover="hover"
                variants={{ idle: { x: 0 }, hover: { x: 4 } }}
              >
                <div className="mr-4 flex-shrink-0 rounded-lg bg-white/10 p-2 text-cyan-300">
                  <Icon size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">{title}</h3>
                  <p className="text-slate-300">{body}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div
          className="relative mx-auto w-full max-w-[520px]"
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: '-10% 0px' }}
          transition={{ duration: 0.8 }}
        >
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500/25 via-purple-500/20 to-cyan-400/20 blur-3xl" />
          <HiringGlobe className="relative" theme="light" />

          <div className="absolute -bottom-4 left-1/2 w-[calc(100%-1rem)] max-w-sm -translate-x-1/2 overflow-hidden rounded-xl border border-white/15 bg-slate-900/80 p-3 shadow-2xl backdrop-blur-md">
            <BorderBeam size={90} duration={8} colorFrom="#67e8f9" colorTo="#a855f7" />
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
              <Clock className="h-3.5 w-3.5" />
              Panel interview · same moment, three clocks
            </div>
            <div className="grid grid-cols-3 divide-x divide-white/10">
              {TIMES.map((t) => (
                <div key={t.city} className="px-2 text-center first:pl-0 last:pr-0">
                  <div className="text-lg font-semibold tabular-nums text-white">{t.time}</div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">
                    {t.city} · {t.zone}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
