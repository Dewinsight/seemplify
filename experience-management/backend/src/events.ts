import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

export function publishEvent(type: string, data: unknown, spaceId?: string | null) {
  const eventData = type === 'ai-job' && data && typeof data === 'object'
    ? ((job: Record<string, unknown>) => ({ id: job.id, kind: job.kind, state: job.state, stage: job.stage, progress: job.progress, updatedAt: job.updatedAt }))(data as Record<string, unknown>)
    : data;
  const eventSpaceId = spaceId || (data && typeof data === 'object' ? String((data as Record<string, unknown>).spaceId || '') : '') || null;
  emitter.emit('event', { type, data: eventData, spaceId: eventSpaceId, at: new Date().toISOString() });
}

export function attachEventStream(
  _request: Request,
  response: Response,
  spaceId: string,
  isAuthorized: () => boolean = () => true
) {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();
  let closed = false;
  let heartbeat: NodeJS.Timeout | null = null;
  const write = (value: string) => {
    if (!closed && !response.destroyed && !response.writableEnded) response.write(value);
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    emitter.off('event', listener);
  };
  const verifyAccess = () => {
    let allowed = false;
    try { allowed = isAuthorized(); } catch { allowed = false; }
    if (allowed) return true;
    write(`event: access-revoked\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    cleanup();
    response.end();
    return false;
  };
  write(`event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  const listener = (event: { type: string; data: unknown; spaceId: string | null; at: string }) => {
    if (event.spaceId !== spaceId) return;
    if (!verifyAccess()) return;
    write(`event: ${event.type}\ndata: ${JSON.stringify({ ...event })}\n\n`);
  };
  heartbeat = setInterval(() => {
    if (verifyAccess()) write(': heartbeat\n\n');
  }, 15_000);
  heartbeat.unref();
  emitter.on('event', listener);
  response.once('close', cleanup);
  response.once('error', cleanup);
}
