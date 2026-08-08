'use client';

import { useEffect, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { applyThemePreference, readThemePreference, ThemePreference, writeThemePreference } from '@/lib/theme-sync';

const options: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export default function ThemePreferenceMenu({ mobile = false }: { mobile?: boolean }) {
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => {
      const next = readThemePreference();
      setPreference(next);
      applyThemePreference(next);
    };
    sync();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => preference === 'system' && applyThemePreference('system');
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    media.addEventListener('change', onSystemChange);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
      media.removeEventListener('change', onSystemChange);
    };
  }, [preference]);

  const CurrentIcon = options.find(option => option.value === preference)?.icon || Monitor;

  if (mobile) {
    return (
      <div className="border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
        <div className="mb-2 text-xs font-medium text-zinc-500">Appearance</div>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
          {options.map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" onClick={() => { writeThemePreference(value); setPreference(value); }} className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors ${preference === value ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-white' : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white'}`}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(value => !value)} aria-label={`Appearance: ${preference}`} aria-expanded={open} className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white">
        <CurrentIcon className="h-4 w-4" />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label="Close appearance menu" onClick={() => setOpen(false)} />
          <div role="menu" className="payroll-popover absolute right-0 top-11 z-50 w-40 p-1">
            {options.map(({ value, label, icon: Icon }) => (
              <button key={value} type="button" role="menuitemradio" aria-checked={preference === value} onClick={() => { writeThemePreference(value); setPreference(value); setOpen(false); }} className={`payroll-popover-item rounded-md ${preference === value ? 'is-active' : ''}`}>
                <Icon className="h-4 w-4" /><span className="flex-1 text-left">{label}</span>{preference === value && <Check className="h-4 w-4" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
