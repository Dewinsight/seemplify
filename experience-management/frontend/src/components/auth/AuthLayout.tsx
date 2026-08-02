import type { ReactNode } from 'react';
import { Link } from '@/lib/router';
import { ExperienceBrand } from '@/components/brand/ExperienceBrand';
import { cn } from '@/lib/utils';

const imagery = {
  research: {
    src: '/images/auth-research.webp',
    alt: 'A customer-experience team reviewing research evidence together.',
    title: 'Bring every signal into view.',
    description: 'Collect feedback, understand conversations, and turn evidence into action.'
  },
  listening: {
    src: '/images/auth-listening.webp',
    alt: 'A researcher listening during a customer interview.',
    title: 'Understanding starts with listening.',
    description: 'Build a clear picture of the people, moments, and decisions that shape an experience.'
  }
} as const;

export function AuthLayout({ children, image = 'research', wide = false }: {
  children: ReactNode;
  image?: keyof typeof imagery;
  wide?: boolean;
}) {
  const artwork = imagery[image];
  return <main className="min-h-screen bg-background lg:grid lg:grid-cols-[minmax(430px,44%)_minmax(0,56%)]">
    <section className="flex min-h-screen flex-col bg-background">
      <header className="flex min-h-20 items-center px-5 py-4 sm:px-9 lg:px-12">
        <ExperienceBrand to="/login" />
      </header>
      <figure className="relative h-44 overflow-hidden border-y bg-muted lg:hidden">
        <img src={artwork.src} alt={artwork.alt} className="h-full w-full object-cover object-[center_58%]" />
      </figure>
      <div className="flex flex-1 items-center px-5 py-8 sm:px-9 lg:px-12 lg:py-12">
        <div className={cn('mx-auto w-full', wide ? 'max-w-xl' : 'max-w-md')}>{children}</div>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-xs text-muted-foreground sm:px-9 lg:px-12">
        <span>© {new Date().getFullYear()} Experience Management</span>
        <span className="flex gap-4"><Link className="hover:text-foreground hover:underline" to="/legal/terms">Terms</Link><Link className="hover:text-foreground hover:underline" to="/legal/privacy">Privacy</Link></span>
      </footer>
    </section>
    <figure className="relative hidden min-h-screen overflow-hidden border-l bg-primary lg:block">
      <img src={artwork.src} alt={artwork.alt} className="absolute inset-0 h-full w-full object-cover" />
      <figcaption className="absolute bottom-0 left-0 max-w-xl border-r border-t border-white/15 bg-primary/95 px-8 py-7 text-primary-foreground xl:px-10 xl:py-9">
        <div className="text-xl font-semibold tracking-[-0.025em]">{artwork.title}</div>
        <p className="mt-2 max-w-md text-sm leading-6 text-primary-foreground/80">{artwork.description}</p>
      </figcaption>
    </figure>
  </main>;
}

export function AuthSteps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['Account', 'Verify email', 'Your profile'];
  return <ol className="mb-7 grid grid-cols-3 border-b" aria-label="Account setup progress">
    {steps.map((label, index) => {
      const number = index + 1;
      const active = number === current;
      const complete = number < current;
      return <li className={cn('relative pb-3 text-xs font-medium', active ? 'text-foreground' : complete ? 'text-primary' : 'text-muted-foreground')} aria-current={active ? 'step' : undefined} key={label}>
        <span className="mr-1.5 tabular-nums">{number}.</span>{label}
        {(active || complete) && <span className={cn('absolute inset-x-0 -bottom-px h-0.5', active ? 'bg-primary' : 'bg-primary/45')} />}
      </li>;
    })}
  </ol>;
}
