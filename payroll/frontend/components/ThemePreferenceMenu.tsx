'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import {
  applyThemePreference,
  readThemePreference,
  ThemePreference,
  writeThemePreference,
} from '@/lib/theme-sync';

const options: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export default function ThemePreferenceMenu({ mobile = false }: { mobile?: boolean }) {
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [open, setOpen] = useState(false);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const sync = () => {
      const next = readThemePreference();
      setPreference(next);
      applyThemePreference(next);
    };
    sync();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      if (readThemePreference() === 'system') applyThemePreference('system');
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sync();
    };
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', onVisibility);
    media.addEventListener('change', onSystemChange);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', onVisibility);
      media.removeEventListener('change', onSystemChange);
    };
  }, []);

  useEffect(() => {
    if (open) selectedRef.current?.focus();
  }, [open]);

  function select(value: ThemePreference) {
    writeThemePreference(value);
    setPreference(value);
  }

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

  const CurrentIcon = options.find((option) => option.value === preference)?.icon || Monitor;

  if (mobile) {
    return (
      <div className="mb-5 border-y border-zinc-800 px-1 py-3">
        <div className="mb-2 text-xs font-medium text-zinc-500">Appearance</div>
        <div
          role="radiogroup"
          aria-label="Appearance"
          onKeyDown={onRadioGroupKeyDown}
          className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-900 p-1"
        >
          {options.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={preference === value}
              tabIndex={preference === value ? 0 : -1}
              onClick={() => select(value)}
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 ${
                preference === value
                  ? 'theme-option-active'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Appearance: ${preference}. Choose a theme`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="theme-menu-trigger"
      >
        <CurrentIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label="Close appearance menu" onClick={closeMenu} />
          <div
            role="menu"
            aria-label="Appearance"
            onKeyDown={onMenuKeyDown}
            className="theme-menu-popover absolute right-0 top-12 z-50 w-40 p-1"
          >
            {options.map(({ value, label, icon: Icon }) => {
              const selected = preference === value;
              return (
                <button
                  key={value}
                  ref={selected ? selectedRef : undefined}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    select(value);
                    closeMenu();
                  }}
                  className={`theme-menu-item ${selected ? 'is-active' : ''}`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span className="flex-1 text-left">{label}</span>
                  {selected && <Check className="h-4 w-4" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
