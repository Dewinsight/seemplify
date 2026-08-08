'use client';

import { useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useThemeMode } from '@/context/ThemeContext';
import type { ThemePreference } from '@/lib/theme-sync';

const options: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export default function ThemePreferenceMenu({ mobile = false }: { mobile?: boolean }) {
  const { preference, setPreference } = useThemeMode();
  const [open, setOpen] = useState(false);
  const CurrentIcon = options.find(option => option.value === preference)?.icon || Monitor;

  if (mobile) return (
    <div className="mb-4">
      <div className="mb-2 text-xs font-medium text-zinc-500">Appearance</div>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-zinc-900">
        {options.map(({ value, label, icon: Icon }) => (
          <button key={value} type="button" onClick={() => setPreference(value)} className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors ${preference === value ? 'bg-white text-gray-950 shadow-sm dark:bg-zinc-800 dark:text-white' : 'text-gray-600 hover:text-gray-950 dark:text-zinc-400 dark:hover:text-white'}`}><Icon className="h-3.5 w-3.5" />{label}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(value => !value)} aria-label={`Appearance: ${preference}`} aria-expanded={open} className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"><CurrentIcon className="h-5 w-5" /></button>
      {open && <><button className="fixed inset-0 z-40 cursor-default" aria-label="Close appearance menu" onClick={() => setOpen(false)} /><div role="menu" className="absolute right-0 top-11 z-50 w-40 rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
        {options.map(({ value, label, icon: Icon }) => <button key={value} type="button" role="menuitemradio" aria-checked={preference === value} onClick={() => { setPreference(value); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-zinc-900"><Icon className="h-4 w-4" /><span className="flex-1 text-left">{label}</span>{preference === value && <Check className="h-4 w-4" />}</button>)}
      </div></>}
    </div>
  );
}
