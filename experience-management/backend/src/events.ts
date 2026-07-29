import { EventEmitter } from 'node:events';
import type { Response } from 'express';

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

export function publishEvent(type: string, data: unknown) {
  emitter.emit('event', { type, data, at: new Date().toISOString() });
}

export function attachEventStream(response: Response) {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();
  response.write(`event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  const listener = (event: { type: string; data: unknown; at: string }) => {
    response.write(`event: ${event.type}\ndata: ${JSON.stringify({ ...event })}\n\n`);
  };
  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000);
  heartbeat.unref();
  emitter.on('event', listener);
  response.on('close', () => {
    clearInterval(heartbeat);
    emitter.off('event', listener);
  });
}
