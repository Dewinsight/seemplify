import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

export function publishEvent(type: string, data: unknown) {
  const eventData = type === 'ai-job' && data && typeof data === 'object'
    ? ((job: Record<string, unknown>) => ({ id: job.id, kind: job.kind, state: job.state, stage: job.stage, progress: job.progress, updatedAt: job.updatedAt }))(data as Record<string, unknown>)
    : data;
  emitter.emit('event', { type, data: eventData, at: new Date().toISOString() });
}

export function attachEventStream(_request: Request, response: Response) {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();
  let closed = false;
  const write = (value: string) => {
    if (!closed && !response.destroyed && !response.writableEnded) response.write(value);
  };
  write(`event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  const listener = (event: { type: string; data: unknown; at: string }) => {
    write(`event: ${event.type}\ndata: ${JSON.stringify({ ...event })}\n\n`);
  };
  const heartbeat = setInterval(() => write(': heartbeat\n\n'), 15_000);
  heartbeat.unref();
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    emitter.off('event', listener);
  };
  emitter.on('event', listener);
  response.once('close', cleanup);
  response.once('error', cleanup);
}
