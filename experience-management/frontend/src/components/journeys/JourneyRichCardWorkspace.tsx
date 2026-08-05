import { useEffect, useMemo, useState } from 'react';
import {
  Archive, FileText, Image, Link2, Loader2, Paperclip, Pencil, Plus, RefreshCw, RotateCcw, Save, Trash2
} from 'lucide-react';
import { ApiError, spaceScopedApiUrl } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { JourneyEmotionalCurve } from '@/components/journeys/JourneyEmotionalCurve';
import { JourneyRichTextDocumentView, JourneyRichTextEditor } from '@/components/journeys/JourneyRichTextEditor';
import type { JourneyMapReadModel } from '@/lib/journeyMaps';
import {
  attachJourneyCardAsset, createJourneyChannel, createJourneyTouchpoint, deleteJourneyCardAsset,
  linkJourneyCardTouchpoint, readJourneyCardRichDetail, restoreJourneyCardAsset, retireJourneyChannel,
  retireJourneyTouchpoint, saveJourneyCardRichDetail, unlinkJourneyCardTouchpoint, updateJourneyChannel,
  updateJourneyTouchpoint, uploadJourneyCardAssetFile,
  type JourneyCardAsset, type JourneyCardRichDetail, type JourneyChannelCategory, type JourneyChannelSnapshot,
  type JourneyEmotionPoint, type JourneyRichMapSnapshot, type JourneyRichTextDocument, type JourneyTouchpointSnapshot
} from '@/lib/journeyRichCards';

const categoryLabels: Record<JourneyChannelCategory, string> = {
  web: 'Web', mobile_app: 'Mobile app', email: 'Email', social: 'Social', phone: 'Phone',
  in_person: 'In person', chat: 'Chat', messaging: 'Messaging', self_service: 'Self-service',
  partner: 'Partner', other: 'Other'
};

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : fallback;
}

function detailFor(snapshot: JourneyRichMapSnapshot, cardId: string) {
  return snapshot.cards.find((detail) => detail.cardId === cardId) || null;
}

function isImageUpload(file: File) {
  return file.type.startsWith('image/') || /\.(?:gif|jpe?g|png|webp)$/iu.test(file.name);
}

function JourneyAssetView({ asset, editable, busy, onDelete, onRestore }: {
  asset: JourneyCardAsset;
  editable: boolean;
  busy: boolean;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const contentUrl = asset.contentUrl ? spaceScopedApiUrl(asset.contentUrl) : null;
  return <li className="border p-3" data-testid={`journey-asset-${asset.id}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {asset.kind === 'image' ? <Image className="h-4 w-4" aria-hidden="true" /> : <Paperclip className="h-4 w-4" aria-hidden="true" />}
          <p className="break-words text-sm font-medium">{asset.displayName}</p>
          {asset.state === 'deleted' && <Badge variant="outline">Deleted</Badge>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {asset.mimeType} · {Math.ceil(asset.byteSize / 1024).toLocaleString()} KB
          {asset.retentionExpiresAt ? ` · recoverable until ${new Date(asset.retentionExpiresAt).toLocaleDateString()}` : ''}
        </p>
      </div>
      {editable && <Button type="button" size="sm" variant="ghost" className="shrink-0" disabled={busy}
        onClick={asset.state === 'deleted' ? onRestore : onDelete}>
        {asset.state === 'deleted' ? <RotateCcw className="mr-1 h-3.5 w-3.5" /> : <Trash2 className="mr-1 h-3.5 w-3.5" />}
        {asset.state === 'deleted' ? 'Restore' : 'Delete'}
      </Button>}
    </div>
    {asset.state === 'active' && asset.kind === 'image' && contentUrl && <figure className="mt-3">
      <img src={contentUrl} alt={asset.altText} loading="lazy" className="max-h-72 w-auto max-w-full border object-contain" />
      {asset.caption && <figcaption className="mt-1 text-xs text-muted-foreground">{asset.caption}</figcaption>}
    </figure>}
    {asset.state === 'active' && asset.kind === 'attachment' && (contentUrl || asset.externalUrl) && <a
      href={contentUrl || asset.externalUrl || '#'} target="_blank" rel="noopener noreferrer"
      className="mt-2 inline-flex items-center gap-1 text-sm underline underline-offset-2">
      <FileText className="h-3.5 w-3.5" />Open attachment
    </a>}
  </li>;
}

function CatalogManager({ channels, touchpoints, editable, busy, onBusy, onChanged, onError }: {
  channels: JourneyChannelSnapshot[];
  touchpoints: JourneyTouchpointSnapshot[];
  editable: boolean;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [channelEditing, setChannelEditing] = useState<JourneyChannelSnapshot | null>(null);
  const [channelName, setChannelName] = useState('');
  const [channelDescription, setChannelDescription] = useState('');
  const [channelCategory, setChannelCategory] = useState<JourneyChannelCategory>('web');
  const [touchpointEditing, setTouchpointEditing] = useState<JourneyTouchpointSnapshot | null>(null);
  const [touchpointName, setTouchpointName] = useState('');
  const [touchpointDescription, setTouchpointDescription] = useState('');
  const [touchpointChannelId, setTouchpointChannelId] = useState('');
  const activeChannels = channels.filter((item) => item.status === 'active');
  const activeTouchpoints = touchpoints.filter((item) => item.status === 'active');

  const resetChannel = () => {
    setChannelEditing(null); setChannelName(''); setChannelDescription(''); setChannelCategory('web');
  };
  const resetTouchpoint = () => {
    setTouchpointEditing(null); setTouchpointName(''); setTouchpointDescription('');
    setTouchpointChannelId(activeChannels[0]?.id || '');
  };
  useEffect(() => {
    if (!touchpointChannelId && activeChannels[0]) setTouchpointChannelId(activeChannels[0].id);
  }, [activeChannels, touchpointChannelId]);

  const run = async (action: () => Promise<unknown>, fallback: string, reset?: () => void) => {
    onBusy(true); onError('');
    try { await action(); reset?.(); await onChanged(); }
    catch (reason) { onError(errorMessage(reason, fallback)); }
    finally { onBusy(false); }
  };

  return <details className="border" data-testid="journey-touchpoint-catalog">
    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Reusable channels and touchpoints</summary>
    <div className="grid gap-5 border-t p-4 xl:grid-cols-2">
      <section aria-labelledby="journey-channels-heading">
        <h3 id="journey-channels-heading" className="text-sm font-semibold">Channels</h3>
        <p className="mt-1 text-xs text-muted-foreground">Stable, versioned ways that people interact with the experience.</p>
        <ul className="mt-3 divide-y border">
          {activeChannels.length === 0 && <li className="p-3 text-sm text-muted-foreground">No active channels.</li>}
          {activeChannels.map((channel) => <li key={channel.id} className="flex items-start justify-between gap-3 p-3">
            <div><p className="text-sm font-medium">{channel.name}</p>
              <p className="text-xs text-muted-foreground">{categoryLabels[channel.category]} · version {channel.versionNumber}</p></div>
            {editable && <div className="flex shrink-0 gap-1">
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => {
                setChannelEditing(channel); setChannelName(channel.name); setChannelDescription(channel.description);
                setChannelCategory(channel.category);
              }}><Pencil className="h-3.5 w-3.5" /><span className="sr-only">Edit {channel.name}</span></Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(
                () => retireJourneyChannel(channel.id, channel.revision), 'The channel could not be retired.')}
              ><Archive className="h-3.5 w-3.5" /><span className="sr-only">Retire {channel.name}</span></Button>
            </div>}
          </li>)}
        </ul>
        {editable && <form className="mt-3 space-y-2" onSubmit={(event) => {
          event.preventDefault();
          if (!channelName.trim()) return;
          void run(() => channelEditing
            ? updateJourneyChannel(channelEditing.id, { expectedRevision: channelEditing.revision,
              name: channelName.trim(), description: channelDescription.trim(), category: channelCategory })
            : createJourneyChannel({ name: channelName.trim(), description: channelDescription.trim(), category: channelCategory }),
          'The channel could not be saved.', resetChannel);
        }}>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><Label htmlFor="journey-channel-name" className="text-xs">Name</Label>
              <Input id="journey-channel-name" value={channelName} maxLength={120}
                onChange={(event) => setChannelName(event.target.value)} placeholder="Mobile app" /></div>
            <div><Label htmlFor="journey-channel-category" className="text-xs">Category</Label>
              <select id="journey-channel-category" className="h-9 w-full border bg-background px-2 text-sm"
                value={channelCategory} onChange={(event) => setChannelCategory(event.target.value as JourneyChannelCategory)}>
                {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></div>
          </div>
          <Label htmlFor="journey-channel-description" className="sr-only">Channel description</Label>
          <Input id="journey-channel-description" value={channelDescription} maxLength={500}
            onChange={(event) => setChannelDescription(event.target.value)} placeholder="Optional description" />
          <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy || !channelName.trim()}>
            {channelEditing ? 'Save channel' : 'Add channel'}</Button>
            {channelEditing && <Button type="button" size="sm" variant="outline" onClick={resetChannel}>Cancel</Button>}
          </div>
        </form>}
      </section>

      <section aria-labelledby="journey-touchpoints-heading">
        <h3 id="journey-touchpoints-heading" className="text-sm font-semibold">Touchpoints</h3>
        <p className="mt-1 text-xs text-muted-foreground">Reusable interactions pinned to the channel version used at publication.</p>
        <ul className="mt-3 divide-y border">
          {activeTouchpoints.length === 0 && <li className="p-3 text-sm text-muted-foreground">No active touchpoints.</li>}
          {activeTouchpoints.map((touchpoint) => <li key={touchpoint.id} className="flex items-start justify-between gap-3 p-3">
            <div><p className="text-sm font-medium">{touchpoint.name}</p>
              <p className="text-xs text-muted-foreground">{touchpoint.channel.name} · version {touchpoint.versionNumber}</p></div>
            {editable && <div className="flex shrink-0 gap-1">
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => {
                setTouchpointEditing(touchpoint); setTouchpointName(touchpoint.name);
                setTouchpointDescription(touchpoint.description); setTouchpointChannelId(touchpoint.channel.id);
              }}><Pencil className="h-3.5 w-3.5" /><span className="sr-only">Edit {touchpoint.name}</span></Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(
                () => retireJourneyTouchpoint(touchpoint.id, touchpoint.revision), 'The touchpoint could not be retired.')}
              ><Archive className="h-3.5 w-3.5" /><span className="sr-only">Retire {touchpoint.name}</span></Button>
            </div>}
          </li>)}
        </ul>
        {editable && <form className="mt-3 space-y-2" onSubmit={(event) => {
          event.preventDefault();
          if (!touchpointName.trim() || !touchpointChannelId) return;
          void run(() => touchpointEditing
            ? updateJourneyTouchpoint(touchpointEditing.id, { expectedRevision: touchpointEditing.revision,
              name: touchpointName.trim(), description: touchpointDescription.trim(), channelId: touchpointChannelId })
            : createJourneyTouchpoint({ name: touchpointName.trim(), description: touchpointDescription.trim(),
              channelId: touchpointChannelId }), 'The touchpoint could not be saved.', resetTouchpoint);
        }}>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><Label htmlFor="journey-touchpoint-name" className="text-xs">Name</Label>
              <Input id="journey-touchpoint-name" value={touchpointName} maxLength={120}
                onChange={(event) => setTouchpointName(event.target.value)} placeholder="Checkout confirmation" /></div>
            <div><Label htmlFor="journey-touchpoint-channel" className="text-xs">Channel</Label>
              <select id="journey-touchpoint-channel" className="h-9 w-full border bg-background px-2 text-sm"
                value={touchpointChannelId} onChange={(event) => setTouchpointChannelId(event.target.value)}>
                <option value="">Choose channel</option>
                {activeChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select></div>
          </div>
          <Label htmlFor="journey-touchpoint-description" className="sr-only">Touchpoint description</Label>
          <Input id="journey-touchpoint-description" value={touchpointDescription} maxLength={500}
            onChange={(event) => setTouchpointDescription(event.target.value)} placeholder="Optional description" />
          <div className="flex gap-2"><Button type="submit" size="sm"
            disabled={busy || !touchpointName.trim() || !touchpointChannelId}>
            {touchpointEditing ? 'Save touchpoint' : 'Add touchpoint'}</Button>
            {touchpointEditing && <Button type="button" size="sm" variant="outline" onClick={resetTouchpoint}>Cancel</Button>}
          </div>
        </form>}
      </section>
    </div>
  </details>;
}

export function JourneyRichCardWorkspace({ map, snapshot, editable, onChanged }: {
  map: JourneyMapReadModel;
  snapshot: JourneyRichMapSnapshot;
  editable: boolean;
  onChanged: () => Promise<void>;
}) {
  const [selectedCardId, setSelectedCardId] = useState(snapshot.cards[0]?.cardId || map.cards[0]?.id || '');
  const selectedCard = map.cards.find((card) => card.id === selectedCardId) || null;
  const snapshotDetail = detailFor(snapshot, selectedCardId);
  const [detail, setDetail] = useState<JourneyCardRichDetail | null>(snapshotDetail);
  const [document, setDocument] = useState<JourneyRichTextDocument>(snapshotDetail?.richText || { version: 1, blocks: [] });
  const [emotion, setEmotion] = useState<JourneyEmotionPoint | null>(snapshotDetail?.emotion || null);
  const [workingRevision, setWorkingRevision] = useState(map.definition.revision);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [touchpointId, setTouchpointId] = useState('');
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [assetAlt, setAssetAlt] = useState('');
  const [assetCaption, setAssetCaption] = useState('');
  const assetFileIsImage = Boolean(assetFile && isImageUpload(assetFile));
  const [externalUrl, setExternalUrl] = useState('');
  const [externalName, setExternalName] = useState('');
  const [catalogBusy, setCatalogBusy] = useState(false);
  const activeTouchpoints = snapshot.catalog.touchpoints.filter((item) => item.status === 'active');
  const availableTouchpoints = activeTouchpoints.filter((item) => !detail?.touchpoints.some((linked) => linked.id === item.id));

  useEffect(() => { setWorkingRevision(map.definition.revision); }, [map.definition.revision]);
  useEffect(() => {
    const first = snapshot.cards[0]?.cardId || map.cards[0]?.id || '';
    if (!map.cards.some((card) => card.id === selectedCardId)) setSelectedCardId(first);
  }, [map.cards, selectedCardId, snapshot.cards]);
  useEffect(() => {
    const fallback = detailFor(snapshot, selectedCardId);
    setDetail(fallback); setDocument(fallback?.richText || { version: 1, blocks: [] }); setEmotion(fallback?.emotion || null);
    setTouchpointId(''); setAssetFile(null); setAssetAlt(''); setAssetCaption(''); setExternalUrl(''); setExternalName('');
    if (!selectedCardId || map.version.state !== 'draft') return;
    let active = true;
    void readJourneyCardRichDetail(map.definition.id, selectedCardId, true).then((loaded) => {
      if (!active) return;
      setDetail(loaded); setDocument(loaded.richText); setEmotion(loaded.emotion);
    }).catch((reason) => { if (active) setError(errorMessage(reason, 'Rich details could not be loaded.')); });
    return () => { active = false; };
  }, [map.definition.id, map.version.state, selectedCardId, snapshot]);

  const stageNames = useMemo(() => new Map(map.stages.map((stage) => [stage.stageKey, stage.name])), [map.stages]);
  const laneNames = useMemo(() => new Map(map.lanes.map((lane) => [lane.laneType, lane.title || lane.laneType])), [map.lanes]);
  const runMutation = async <T,>(label: string, action: (revision: number) => Promise<T>, apply: (result: T) => void) => {
    setBusy(label); setError('');
    try {
      const result = await action(workingRevision);
      apply(result); setWorkingRevision((current) => current + 1);
      await onChanged();
    } catch (reason) { setError(errorMessage(reason, 'The rich-card change could not be saved.')); }
    finally { setBusy(''); }
  };

  const saveDetail = () => {
    if (!selectedCard || !detail) return;
    void runMutation('save', (expectedRevision) => saveJourneyCardRichDetail(map.definition.id, selectedCard.id, {
      expectedRevision, expectedDetailRevision: detail.revision, richText: document,
      emotion: selectedCard.kind === 'emotion' ? emotion : null
    }), (next) => { setDetail(next); setDocument(next.richText); setEmotion(next.emotion); });
  };
  const refreshSelected = async () => {
    if (!selectedCard) return;
    setBusy('refresh'); setError('');
    try {
      const next = await readJourneyCardRichDetail(map.definition.id, selectedCard.id, true);
      setDetail(next); setDocument(next.richText); setEmotion(next.emotion);
      await onChanged();
    } catch (reason) { setError(errorMessage(reason, 'Rich details could not be refreshed.')); }
    finally { setBusy(''); }
  };

  if (!map.cards.length) return <div className="border border-dashed px-5 py-12 text-center text-sm text-muted-foreground">
    Add a journey card before recording rich detail, touchpoints, media, or an emotional curve.
  </div>;

  return <div className="space-y-5" data-testid="journey-rich-card-workspace">
    {error && <p className="border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert" data-testid="journey-rich-card-error">{error}</p>}
    <section className="border" aria-labelledby="journey-emotional-curve-heading">
      <div className="border-b px-4 py-3"><h2 id="journey-emotional-curve-heading" className="text-sm font-semibold">Emotional curve</h2>
        <p className="mt-1 text-xs text-muted-foreground">Only exact values entered on emotion cards are plotted. No average or inferred score is added.</p></div>
      <div className="p-4"><JourneyEmotionalCurve points={snapshot.emotionalCurve} /></div>
    </section>

    <CatalogManager channels={snapshot.catalog.channels} touchpoints={snapshot.catalog.touchpoints}
      editable={editable} busy={catalogBusy} onBusy={setCatalogBusy} onError={setError} onChanged={onChanged} />

    <div className="grid min-w-0 gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="min-w-0 border" aria-label="Journey card outline">
        <div className="border-b px-3 py-2"><p className="text-sm font-semibold">Cards</p>
          <p className="text-xs text-muted-foreground">{map.cards.length} in this version</p></div>
        <ol className="max-h-[700px] divide-y overflow-y-auto">
          {map.cards.map((card) => <li key={card.id}>
            <button type="button" className={`w-full px-3 py-3 text-left hover:bg-muted/40 ${card.id === selectedCardId ? 'bg-muted/60' : ''}`}
              aria-current={card.id === selectedCardId ? 'true' : undefined} onClick={() => setSelectedCardId(card.id)}>
              <span className="block truncate text-sm font-medium">{card.title}</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {stageNames.get(card.stageKey) || card.stageKey} · {laneNames.get(card.laneType) || card.laneType}
              </span>
            </button>
          </li>)}
        </ol>
      </aside>

      {selectedCard && detail && <div className="min-w-0 space-y-5">
        <section className="border" aria-labelledby="journey-rich-detail-heading">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
            <div><h2 id="journey-rich-detail-heading" className="text-sm font-semibold">{selectedCard.title}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{stageNames.get(selectedCard.stageKey)} · {laneNames.get(selectedCard.laneType)} · {selectedCard.kind.replaceAll('_', ' ')}</p></div>
            <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void refreshSelected()}>
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} />Refresh
            </Button>
          </div>
          <div className="space-y-4 p-4">
            {editable ? <>
              {document.blocks.length === 0 && selectedCard.content && <div className="flex flex-wrap items-center justify-between gap-2 border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">This card still has plain details from the map editor.</p>
                <Button type="button" size="sm" variant="outline" onClick={() => setDocument({ version: 1,
                  blocks: [{ type: 'paragraph', text: selectedCard.content, marks: [] }] })}>Use plain details as first block</Button>
              </div>}
              <JourneyRichTextEditor value={document} onChange={setDocument} disabled={Boolean(busy)}
                blockLimit={snapshot.limits.richTextBlocks} blockCharacterLimit={snapshot.limits.blockCharacters} />
              {selectedCard.kind === 'emotion' && <fieldset className="border p-3">
                <legend className="px-1 text-sm font-medium">Exact emotion point</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div><Label htmlFor="journey-emotion-label" className="text-xs">Label</Label>
                    <Input id="journey-emotion-label" maxLength={120} value={emotion?.label || ''}
                      onChange={(event) => setEmotion({ valence: emotion?.valence ?? 0, intensity: emotion?.intensity ?? 0, label: event.target.value })}
                      placeholder="Relieved" /></div>
                  <div><Label htmlFor="journey-emotion-valence" className="text-xs">Valence (−5 to +5)</Label>
                    <Input id="journey-emotion-valence" type="number" min={-5} max={5} step={1} value={emotion?.valence ?? 0}
                      onChange={(event) => setEmotion({ valence: Number(event.target.value), intensity: emotion?.intensity ?? 0, label: emotion?.label || '' })} /></div>
                  <div><Label htmlFor="journey-emotion-intensity" className="text-xs">Intensity (0 to 5)</Label>
                    <Input id="journey-emotion-intensity" type="number" min={0} max={5} step={1} value={emotion?.intensity ?? 0}
                      onChange={(event) => setEmotion({ valence: emotion?.valence ?? 0, intensity: Number(event.target.value), label: emotion?.label || '' })} /></div>
                </div>
                {emotion && <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setEmotion(null)}>Remove point</Button>}
              </fieldset>}
              <div className="flex justify-end"><Button type="button" disabled={Boolean(busy)} onClick={saveDetail} data-testid="save-journey-rich-detail">
                {busy === 'save' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save rich details
              </Button></div>
            </> : <JourneyRichTextDocumentView document={detail.richText} empty={selectedCard.content || 'No details recorded.'} />}
          </div>
        </section>

        <section className="border" aria-labelledby="journey-card-touchpoints-heading">
          <div className="border-b px-4 py-3"><h2 id="journey-card-touchpoints-heading" className="text-sm font-semibold">Touchpoints</h2>
            <p className="mt-1 text-xs text-muted-foreground">Published maps keep the exact channel and touchpoint versions shown here.</p></div>
          <div className="space-y-3 p-4">
            {detail.touchpoints.length === 0 ? <p className="text-sm text-muted-foreground">No touchpoints linked.</p> : <ul className="flex flex-wrap gap-2">
              {detail.touchpoints.map((touchpoint) => <li key={touchpoint.id} className="inline-flex items-center gap-2 border px-2.5 py-1.5 text-xs">
                <span><strong>{touchpoint.name}</strong> · {touchpoint.channel.name}</span>
                {editable && <button type="button" className="underline underline-offset-2" disabled={Boolean(busy)} onClick={() => void runMutation(
                  'touchpoint', (expectedRevision) => unlinkJourneyCardTouchpoint(map.definition.id, selectedCard.id, touchpoint.id, expectedRevision),
                  setDetail)}>Remove<span className="sr-only"> {touchpoint.name}</span></button>}
              </li>)}
            </ul>}
            {editable && <div className="flex flex-col gap-2 sm:flex-row">
              <Label htmlFor="journey-link-touchpoint" className="sr-only">Touchpoint to link</Label>
              <select id="journey-link-touchpoint" className="h-9 min-w-0 flex-1 border bg-background px-2 text-sm"
                value={touchpointId} onChange={(event) => setTouchpointId(event.target.value)}>
                <option value="">Choose reusable touchpoint</option>
                {availableTouchpoints.map((touchpoint) => <option key={touchpoint.id} value={touchpoint.id}>{touchpoint.name} · {touchpoint.channel.name}</option>)}
              </select>
              <Button type="button" size="sm" variant="outline" disabled={Boolean(busy) || !touchpointId} onClick={() => void runMutation(
                'touchpoint', (expectedRevision) => linkJourneyCardTouchpoint(map.definition.id, selectedCard.id, expectedRevision, touchpointId),
                (next) => { setDetail(next); setTouchpointId(''); })}><Link2 className="mr-2 h-3.5 w-3.5" />Link</Button>
            </div>}
          </div>
        </section>

        <section className="border" aria-labelledby="journey-card-assets-heading">
          <div className="border-b px-4 py-3"><h2 id="journey-card-assets-heading" className="text-sm font-semibold">Images and attachments</h2>
            <p className="mt-1 text-xs text-muted-foreground">Uploads are type-checked, integrity-checked, access-controlled, and retained for {snapshot.limits.deletedAssetRetentionDays} days after deletion.</p></div>
          <div className="space-y-4 p-4">
            {detail.assets.length === 0 ? <p className="text-sm text-muted-foreground">No governed media attached.</p> : <ul className="grid gap-3 md:grid-cols-2">
              {detail.assets.map((asset) => <JourneyAssetView key={asset.id} asset={asset} editable={editable} busy={Boolean(busy)}
                onDelete={() => void runMutation('asset', (expectedRevision) => deleteJourneyCardAsset(map.definition.id, selectedCard.id, asset.id, expectedRevision), setDetail)}
                onRestore={() => void runMutation('asset', (expectedRevision) => restoreJourneyCardAsset(map.definition.id, selectedCard.id, asset.id, expectedRevision), setDetail)} />)}
            </ul>}
            {editable && <div className="grid gap-4 border-t pt-4 lg:grid-cols-2">
              <form className="space-y-2" onSubmit={(event) => {
                event.preventDefault(); if (!assetFile) return;
                const isImage = isImageUpload(assetFile);
                void runMutation('upload', async (expectedRevision) => {
                  const upload = await uploadJourneyCardAssetFile(assetFile);
                  return attachJourneyCardAsset(map.definition.id, selectedCard.id, { expectedRevision,
                    kind: isImage ? 'image' : 'attachment', uploadId: upload.id, displayName: upload.name,
                    mimeType: upload.mimeType, altText: isImage ? assetAlt.trim() : '', caption: assetCaption.trim() });
                }, (result) => { setDetail(result.detail); setAssetFile(null); setAssetAlt(''); setAssetCaption(''); });
              }}>
                <h3 className="text-sm font-medium">Upload a file</h3>
                <Label htmlFor="journey-asset-file" className="text-xs">Image or PDF</Label>
                <Input id="journey-asset-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" disabled={Boolean(busy)}
                  onChange={(event) => setAssetFile(event.target.files?.[0] || null)} />
                {assetFileIsImage && <><Label htmlFor="journey-asset-alt" className="text-xs">Alternative text</Label>
                  <Input id="journey-asset-alt" value={assetAlt} maxLength={snapshot.limits.altTextCharacters}
                    onChange={(event) => setAssetAlt(event.target.value)} placeholder="Describe what the image communicates" /></>}
                <Label htmlFor="journey-asset-caption" className="text-xs">Caption (optional)</Label>
                <Input id="journey-asset-caption" value={assetCaption} maxLength={snapshot.limits.captionCharacters}
                  onChange={(event) => setAssetCaption(event.target.value)} />
                <Button type="submit" size="sm" disabled={Boolean(busy) || !assetFile || (assetFileIsImage && !assetAlt.trim())}>
                  {busy === 'upload' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-2 h-3.5 w-3.5" />}Attach file
                </Button>
              </form>
              <form className="space-y-2" onSubmit={(event) => {
                event.preventDefault(); if (!externalUrl.trim()) return;
                void runMutation('external', (expectedRevision) => attachJourneyCardAsset(map.definition.id, selectedCard.id, {
                  expectedRevision, kind: 'attachment', externalUrl: externalUrl.trim(), displayName: externalName.trim() || undefined,
                  caption: assetCaption.trim()
                }), (result) => { setDetail(result.detail); setExternalUrl(''); setExternalName(''); });
              }}>
                <h3 className="text-sm font-medium">Link an external attachment</h3>
                <Label htmlFor="journey-external-url" className="text-xs">HTTPS URL</Label>
                <Input id="journey-external-url" type="url" value={externalUrl} maxLength={snapshot.limits.externalUrlCharacters}
                  onChange={(event) => setExternalUrl(event.target.value)} placeholder="https://example.com/document.pdf" />
                <Label htmlFor="journey-external-name" className="text-xs">Display name</Label>
                <Input id="journey-external-name" value={externalName} maxLength={snapshot.limits.assetNameCharacters}
                  onChange={(event) => setExternalName(event.target.value)} placeholder="Research brief" />
                <Button type="submit" size="sm" variant="outline" disabled={Boolean(busy) || !externalUrl.trim()}>
                  {busy === 'external' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-2 h-3.5 w-3.5" />}Attach link
                </Button>
              </form>
            </div>}
          </div>
        </section>
      </div>}
    </div>
  </div>;
}
