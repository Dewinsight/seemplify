import { FileText, Image, Paperclip } from 'lucide-react';
import { spaceScopedApiUrl } from '@/lib/api';
import { JourneyRichTextDocumentView } from '@/components/journeys/JourneyRichTextEditor';
import type { JourneyMapCard } from '@/lib/journeyMaps';
import type { JourneyCardAsset, JourneyCardRichDetail } from '@/lib/journeyRichCards';

function ReadOnlyAsset({ asset }: { asset: JourneyCardAsset }) {
  const contentUrl = asset.contentUrl ? spaceScopedApiUrl(asset.contentUrl) : null;
  return <li className="border p-3">
    <div className="flex items-start gap-2">
      {asset.kind === 'image' ? <Image className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        : <Paperclip className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
      <div className="min-w-0"><p className="break-words text-sm font-medium">{asset.displayName}</p>
        <p className="mt-1 text-xs text-muted-foreground">{asset.mimeType} · {Math.ceil(asset.byteSize / 1024).toLocaleString()} KB</p></div>
    </div>
    {asset.kind === 'image' && contentUrl && <figure className="mt-3">
      <img src={contentUrl} alt={asset.altText} loading="lazy" className="max-h-72 w-auto max-w-full border object-contain" />
      {asset.caption && <figcaption className="mt-1 text-xs text-muted-foreground">{asset.caption}</figcaption>}
    </figure>}
    {asset.kind === 'attachment' && (contentUrl || asset.externalUrl) && <a
      href={contentUrl || asset.externalUrl || '#'} target="_blank" rel="noopener noreferrer"
      className="mt-2 inline-flex items-center gap-1 text-sm underline underline-offset-2">
      <FileText className="h-3.5 w-3.5" />Open attachment
    </a>}
  </li>;
}

export function JourneyRichCardReadView({ card, detail }: { card: JourneyMapCard; detail: JourneyCardRichDetail | null }) {
  if (!detail) return <p className="whitespace-pre-wrap text-sm leading-6">{card.content || 'No details recorded.'}</p>;
  const hasRichText = detail.richText.blocks.some((block) => block.text.trim());
  const assets = detail.assets.filter((asset) => asset.state === 'active');
  return <div className="space-y-4" data-testid="journey-rich-card-read-view">
    {hasRichText ? <JourneyRichTextDocumentView document={detail.richText} />
      : <p className="whitespace-pre-wrap text-sm leading-6">{card.content || 'No details recorded.'}</p>}
    {detail.emotion && <dl className="grid grid-cols-3 gap-2 border p-3 text-xs">
      <div><dt className="text-muted-foreground">Emotion</dt><dd className="font-medium">{detail.emotion.label || 'Unlabelled'}</dd></div>
      <div><dt className="text-muted-foreground">Valence</dt><dd className="tabular-nums">{detail.emotion.valence > 0 ? `+${detail.emotion.valence}` : detail.emotion.valence}</dd></div>
      <div><dt className="text-muted-foreground">Intensity</dt><dd className="tabular-nums">{detail.emotion.intensity}</dd></div>
    </dl>}
    {detail.touchpoints.length > 0 && <ul className="flex flex-wrap gap-1.5" aria-label="Touchpoints">
      {detail.touchpoints.map((touchpoint) => <li key={touchpoint.id} className="border px-2 py-1 text-xs">
        {touchpoint.name} · {touchpoint.channel.name}
      </li>)}
    </ul>}
    {assets.length > 0 && <ul className="grid gap-3 sm:grid-cols-2">
      {assets.map((asset) => <ReadOnlyAsset key={asset.id} asset={asset} />)}
    </ul>}
  </div>;
}
