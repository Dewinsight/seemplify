'use client';

import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Calendar,
  Cpu,
  FileCheck,
  FileText,
  Kanban,
  Mail,
  Shield,
  Sparkles,
  Upload,
  Users,
  Video,
} from 'lucide-react';
import Marquee from '@/components/landing/motion/Marquee';

// Every item maps to a real surface in the product (routes, sections, or copy already on this page).
const ROW_A: [string, LucideIcon][] = [
  ['AI candidate matching', Cpu],
  ['Automated interview scheduling', Calendar],
  ['Bulk CV upload & parsing', Upload],
  ['AI notetaker & transcripts', FileCheck],
  ['Structured feedback forms', FileText],
  ['Multi-stage pipeline board', Kanban],
];

const ROW_B: [string, LucideIcon][] = [
  ['Analytics dashboard', BarChart3],
  ['Team collaboration', Users],
  ['Calendar sync', Calendar],
  ['Candidate email templates', Mail],
  ['AI interviews', Video],
  ['Enterprise-grade security', Shield],
  ['Bias-aware ranking', Sparkles],
];

function Chip({ label, Icon }: { label: string; Icon: LucideIcon }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-200 backdrop-blur">
      <Icon className="h-4 w-4 text-purple-300" />
      {label}
    </span>
  );
}

export default function CapabilityMarquee() {
  return (
    <section aria-label="Platform capabilities" className="relative z-10 py-6 md:py-10">
      <p className="mb-6 text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
        Everything a hiring team touches, in one place
      </p>
      <div className="space-y-3">
        <Marquee duration={42}>
          {ROW_A.map(([label, Icon]) => (
            <Chip key={label} label={label} Icon={Icon} />
          ))}
        </Marquee>
        <Marquee duration={48} reverse>
          {ROW_B.map(([label, Icon]) => (
            <Chip key={label} label={label} Icon={Icon} />
          ))}
        </Marquee>
      </div>
    </section>
  );
}
