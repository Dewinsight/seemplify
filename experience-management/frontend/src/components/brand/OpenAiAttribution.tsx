import { cn } from '@/lib/utils';

export type OpenAiAttributionProps = {
  className?: string;
  compact?: boolean;
  showModel?: boolean;
  model?: string | null;
};

export function OpenAiAttribution({
  className,
  compact = false,
  showModel = false,
  model
}: OpenAiAttributionProps) {
  const displayedModel = showModel && model?.trim() ? model.trim() : null;

  return <span
    data-testid="chatgpt-runtime-attribution"
    className={cn(
      'inline-flex min-w-0 items-center text-muted-foreground',
      compact ? 'gap-1.5 text-[11px]' : 'gap-2 text-xs',
      className
    )}
  >
    <span
      data-testid="openai-brand-mark"
      aria-hidden="true"
      className={cn('relative block shrink-0', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')}
    >
      <img
        src="/brand/OAI_OpenAI-Blossom_Black.svg"
        alt=""
        className="block h-full w-full dark:hidden"
      />
      <img
        src="/brand/OAI_OpenAI-Blossom_White.svg"
        alt=""
        className="hidden h-full w-full dark:block"
      />
    </span>
    <span className="shrink-0 whitespace-nowrap">Powered by <span className="font-medium text-foreground">ChatGPT</span></span>
    {displayedModel && <>
      <span aria-hidden="true" className="shrink-0 text-border">&middot;</span>
      <span className="min-w-0 truncate" title={displayedModel}>{displayedModel}</span>
    </>}
  </span>;
}
