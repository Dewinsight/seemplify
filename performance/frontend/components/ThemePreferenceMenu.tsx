'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useThemeMode } from '@/context/ThemeContext';
import type { ThemePreference } from '@/lib/theme-sync';

const options: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export default function ThemePreferenceMenu({ mobile = false }: { mobile?: boolean }) {
  const { preference, setPreference } = useThemeMode();
  const [open, setOpen] = useState(false);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const CurrentIcon = options.find(option => option.value === preference)?.icon || Monitor;

  useEffect(() => {
    if (open) selectedRef.current?.focus();
  }, [open]);

  function closeMenu() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function onRadioGroupKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % items.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    items[next]?.click();
    items[next]?.focus();
    event.preventDefault();
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') {
      closeMenu();
      event.preventDefault();
      return;
    } else return;
    items[next]?.focus();
    event.preventDefault();
  }

  if (mobile) return (
    <div className="mb-4">
      <div className="mb-2 text-xs font-medium text-zinc-500">Appearance</div>
      <div role="radiogroup" aria-label="Appearance" onKeyDown={onRadioGroupKeyDown} className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-zinc-900">
        {options.map(({ value, label, icon: Icon }) => (
          <button key={value} type="button" role="radio" aria-checked={preference === value} tabIndex={preference === value ? 0 : -1} onClick={() => setPreference(value)} className={`flex min-h-11 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${preference === value ? 'bg-white text-gray-950 shadow-sm dark:bg-zinc-800 dark:text-white' : 'text-gray-600 hover:text-gray-950 dark:text-zinc-400 dark:hover:text-white'}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="relative">
      <button ref={triggerRef} type="button" onClick={() => setOpen(value => !value)} aria-label={`Appearance: ${preference}. Choose a theme`} aria-haspopup="menu" aria-expanded={open} className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"><CurrentIcon className="h-5 w-5" aria-hidden="true" /></button>
      {open && <><button className="fixed inset-0 z-40 cursor-default" aria-label="Close appearance menu" onClick={closeMenu} /><div role="menu" aria-label="Appearance" onKeyDown={onMenuKeyDown} className="absolute right-0 top-[52px] z-50 w-40 rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
        {options.map(({ value, label, icon: Icon }) => {
          const selected = preference === value;
          return <button key={value} ref={selected ? selectedRef : undefined} type="button" role="menuitemradio" aria-checked={selected} onClick={() => { setPreference(value); closeMenu(); }} className={`flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 dark:text-zinc-300 dark:hover:bg-zinc-900 ${selected ? 'bg-gray-100 dark:bg-zinc-900' : ''}`}><Icon className="h-4 w-4" aria-hidden="true" /><span className="flex-1 text-left">{label}</span>{selected && <Check className="h-4 w-4" aria-hidden="true" />}</button>;
        })}
      </div></>}
    </div>
  );
}
