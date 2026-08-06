"use client";

import { cn } from "@/lib/utils";
import {
  getAIInterviewVoiceAvatar,
  getAIInterviewVoiceInitials,
  type AIInterviewVoiceAvatarInput,
  type AIInterviewVoiceAvatarProfile
} from "@/lib/aiVoiceAvatars";

const avatarSizeClass = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
  xl: "h-16 w-16",
  "2xl": "h-20 w-20"
};

const waveToneClass: Record<AIInterviewVoiceAvatarProfile["tone"] | "white", string> = {
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  slate: "bg-slate-500",
  cyan: "bg-cyan-500",
  violet: "bg-violet-500",
  indigo: "bg-indigo-500",
  rose: "bg-rose-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  purple: "bg-purple-500",
  white: "bg-white"
};

const ringToneClass: Record<AIInterviewVoiceAvatarProfile["tone"], string> = {
  emerald: "ring-emerald-300",
  blue: "ring-blue-300",
  slate: "ring-slate-300",
  cyan: "ring-cyan-300",
  violet: "ring-violet-300",
  indigo: "ring-indigo-300",
  rose: "ring-rose-300",
  amber: "ring-amber-300",
  orange: "ring-orange-300",
  purple: "ring-purple-300"
};

export function AIVoiceAvatar({
  voice,
  size = "md",
  active = false,
  decorative = false,
  className,
  imageClassName
}: {
  voice?: AIInterviewVoiceAvatarInput;
  size?: keyof typeof avatarSizeClass;
  active?: boolean;
  decorative?: boolean;
  className?: string;
  imageClassName?: string;
}) {
  const avatar = getAIInterviewVoiceAvatar(voice);
  const initials = getAIInterviewVoiceInitials(voice);
  const alt = decorative ? "" : `${avatar.label} AI interviewer avatar`;

  return (
    <span className={cn("relative inline-flex shrink-0", avatarSizeClass[size], className)}>
      {active && (
        <>
          <span className={cn("absolute inset-0 animate-ping rounded-full opacity-50 ring-2 ring-offset-2 ring-offset-white", ringToneClass[avatar.tone])} />
          <span className={cn("absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white", waveToneClass[avatar.tone])} />
        </>
      )}
      <span className="relative flex h-full w-full overflow-hidden rounded-full border border-white/70 bg-slate-100 shadow-sm">
        <img
          src={avatar.src}
          alt={alt}
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = "none";
            event.currentTarget.nextElementSibling?.classList.remove("hidden");
            event.currentTarget.nextElementSibling?.classList.add("flex");
          }}
          className={cn("h-full w-full object-cover", imageClassName)}
        />
        <span className="absolute inset-0 hidden items-center justify-center bg-slate-900 text-xs font-semibold text-white">
          {initials}
        </span>
      </span>
    </span>
  );
}

export function AIVoiceWave({
  active,
  level = 42,
  tone = "emerald",
  compact = false,
  className
}: {
  active?: boolean;
  level?: number;
  tone?: AIInterviewVoiceAvatarProfile["tone"] | "white";
  compact?: boolean;
  className?: string;
}) {
  const bars = Array.from({ length: compact ? 10 : 14 });
  const normalized = Math.max(8, Math.min(100, level));

  return (
    <span className={cn("inline-flex items-center", compact ? "h-6 gap-0.5" : "h-8 gap-1", className)}>
      {bars.map((_, index) => {
        const wave = Math.abs(Math.sin((index + 1) * 0.68));
        const height = compact
          ? 5 + wave * 12 + (normalized / 100) * 7
          : 7 + wave * 16 + (normalized / 100) * 10;

        return (
          <span
            key={index}
            className={cn("w-1 rounded-full transition-all duration-150", waveToneClass[tone], active ? "animate-pulse" : "")}
            style={{
              height: `${Math.round(height)}px`,
              opacity: active ? 0.48 + wave * 0.42 : 0.28 + wave * 0.22,
              animationDelay: `${index * 45}ms`
            }}
          />
        );
      })}
    </span>
  );
}
