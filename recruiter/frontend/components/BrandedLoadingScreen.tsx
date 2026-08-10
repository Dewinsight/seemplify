'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CircleAlert,
  KeyRound,
  LayoutDashboard,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useBrandConfig } from '@/context/BrandContext';
import { cn } from '@/lib/utils';

export interface BrandedLoadingStage {
  label: string;
  icon: LucideIcon;
}

interface BrandedLoadingScreenProps {
  message?: string;
  stages?: BrandedLoadingStage[];
  stageIntervalMs?: number;
  inAppShell?: boolean;
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}

const DEFAULT_STAGES: BrandedLoadingStage[] = [
  { label: 'Verifying your credentials', icon: KeyRound },
  { label: 'Checking workspace access', icon: Building2 },
  { label: 'Loading your preferences', icon: ShieldCheck },
  { label: 'Checking your invitations', icon: MailCheck },
  { label: 'Preparing your dashboard', icon: LayoutDashboard },
];

const BACKGROUND_POINTS = [
  ['7%', '12%'],
  ['21%', '7%'],
  ['34%', '47%'],
  ['43%', '32%'],
  ['52%', '15%'],
  ['61%', '19%'],
  ['73%', '54%'],
  ['81%', '22%'],
  ['92%', '35%'],
  ['13%', '58%'],
  ['29%', '49%'],
  ['65%', '70%'],
  ['83%', '51%'],
  ['94%', '88%'],
  ['40%', '85%'],
] as const;

function withAlpha(hex: string, alpha: string) {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alpha}` : hex;
}

export function BrandedLoadingScreen({
  message = 'Loading your account…',
  stages = DEFAULT_STAGES,
  stageIntervalMs = 2400,
  inAppShell = false,
  error = null,
  onRetry,
  className,
}: BrandedLoadingScreenProps) {
  const brand = useBrandConfig();
  const safeStages = useMemo(
    () => (stages.length ? stages : DEFAULT_STAGES),
    [stages]
  );
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    setStageIndex(0);
  }, [safeStages]);

  useEffect(() => {
    if (error || safeStages.length < 2) return;

    const interval = window.setInterval(() => {
      setStageIndex((current) => (current + 1) % safeStages.length);
    }, stageIntervalMs);

    return () => window.clearInterval(interval);
  }, [error, safeStages, stageIntervalMs]);

  const currentStage = safeStages[stageIndex] ?? safeStages[0];
  const StatusIcon = error ? CircleAlert : currentStage.icon;
  const primary = brand.colors.primary;
  const secondary = brand.colors.secondary;
  const progress = error ? 100 : ((stageIndex + 1) / safeStages.length) * 100;

  return (
    <div
      className={cn(
        'relative isolate flex w-full items-center justify-center overflow-hidden bg-[#101326] px-5 py-10 text-white',
        inAppShell ? 'min-h-[calc(100dvh-5rem)]' : 'min-h-dvh',
        className
      )}
      style={{
        backgroundImage: [
          `radial-gradient(circle at 18% 82%, ${withAlpha(secondary, '5c')} 0, transparent 31%)`,
          `radial-gradient(circle at 76% 18%, ${withAlpha(primary, '4d')} 0, transparent 34%)`,
          'linear-gradient(135deg, #101326 0%, #1d1738 52%, #12162a 100%)',
        ].join(', '),
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.65) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.65) 1px, transparent 1px)',
          backgroundSize: '52px 52px',
        }}
      />

      <div aria-hidden="true" className="absolute inset-0">
        {BACKGROUND_POINTS.map(([left, top], index) => (
          <span
            key={`${left}-${top}`}
            className="absolute h-1 w-1 rounded-full opacity-50 motion-safe:animate-pulse"
            style={{
              left,
              top,
              backgroundColor: index % 3 === 0 ? secondary : primary,
              animationDelay: `${(index % 5) * 220}ms`,
              animationDuration: `${1800 + (index % 4) * 350}ms`,
            }}
          />
        ))}
      </div>

      <section
        aria-live="polite"
        aria-busy={!error}
        role={error ? 'alert' : 'status'}
        className="relative z-10 w-full max-w-[400px] rounded-xl border border-white/20 bg-white/[0.11] px-8 py-8 text-center shadow-[0_8px_28px_rgba(4,6,20,0.24)] backdrop-blur-md sm:px-10"
      >
        <div className="mb-7 flex justify-center">
          {brand.useImageLogo && brand.logo ? (
            <div className="flex h-16 min-w-16 items-center justify-center rounded-lg bg-white px-3">
              <Image
                src={brand.logo}
                alt={brand.name}
                width={144}
                height={48}
                className="h-12 w-auto object-contain"
                priority
              />
            </div>
          ) : (
            <div
              className="relative flex h-16 w-16 items-center justify-center rounded-xl text-2xl font-bold tracking-tight shadow-[0_4px_12px_rgba(4,6,20,0.2)]"
              style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}
              aria-label={brand.name}
            >
              {brand.shortName}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute -right-1 -top-1 h-4 w-4 rounded-full border-2 border-[#191a31]',
                  brand.colors.pulse
                )}
              />
            </div>
          )}
        </div>

        <div className="relative mx-auto mb-6 h-24 w-24">
          <div className="absolute inset-0 rounded-full border-2 border-white/10" />
          <div className="absolute inset-2 rounded-full border border-white/15 motion-safe:animate-pulse" />
          <div
            className={cn(
              'absolute inset-1 rounded-full border-[3px] border-white/10',
              !error && 'motion-safe:animate-spin'
            )}
            style={{
              borderTopColor: error ? '#fca5a5' : primary,
              borderRightColor: error ? '#ef4444' : secondary,
              animationDuration: '1.35s',
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <StatusIcon className={cn('h-6 w-6', error ? 'text-red-200' : 'text-white')} />
          </div>
        </div>

        <div className="mx-auto mb-7 h-1 w-48 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{
              width: `${progress}%`,
              background: error ? '#ef4444' : `linear-gradient(90deg, ${primary}, ${secondary})`,
            }}
          />
        </div>

        <h1 className="text-xl font-semibold tracking-tight">
          {error ? 'We could not finish loading' : `${currentStage.label}…`}
        </h1>
        <p className="mt-2 text-sm text-white/70">{error || message}</p>

        {error && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/25 bg-white px-4 text-sm font-medium text-slate-950 transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        ) : (
          <div aria-hidden="true" className="mt-5 flex justify-center gap-2">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="h-2 w-2 rounded-full motion-safe:animate-bounce"
                style={{
                  backgroundColor: dot === 1 ? secondary : primary,
                  animationDelay: `${dot * 140}ms`,
                  animationDuration: '1.1s',
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export const recruiterLoadingStages = DEFAULT_STAGES;
