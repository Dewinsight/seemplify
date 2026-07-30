import type { Request, Response } from 'express';
import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import { db } from './database.js';

export const tutorialKeys = [
  'overview',
  'surveys',
  'campaigns',
  'agreements',
  'social-listening',
  'intelligence',
  'knowledge-bases',
  'journey-maps',
  'ai-queue',
  'service-recovery',
  'space-settings'
] as const;

export const tutorialStatuses = ['in_progress', 'completed', 'dismissed'] as const;

const tutorialKeySchema = z.enum(tutorialKeys);
const progressInputSchema = z.object({
  version: z.number().int().min(1).max(10_000),
  status: z.enum(tutorialStatuses),
  lastStep: z.number().int().min(0).max(10_000).nullable()
}).strict();

type TutorialKey = z.infer<typeof tutorialKeySchema>;
type TutorialStatus = z.infer<typeof progressInputSchema>['status'];

type ProgressInput = {
  version: number;
  status: TutorialStatus;
  lastStep: number | null;
};

function progressRow(row: any) {
  return {
    tutorialKey: row.tutorial_key as TutorialKey,
    version: Number(row.version),
    status: row.status as TutorialStatus,
    lastStep: row.last_step == null ? null : Number(row.last_step),
    firstOpenedAt: row.first_opened_at,
    completedAt: row.completed_at,
    dismissedAt: row.dismissed_at,
    updatedAt: row.updated_at
  };
}

export function listTutorialProgress(userId: string) {
  return (db.prepare(`SELECT tutorial_key,version,status,last_step,first_opened_at,completed_at,dismissed_at,updated_at
    FROM tutorial_progress WHERE user_id=? ORDER BY tutorial_key`).all(userId) as any[]).map(progressRow);
}

export const saveTutorialProgress = db.transaction((userId: string, tutorialKey: TutorialKey, input: ProgressInput) => {
  const current = db.prepare('SELECT * FROM tutorial_progress WHERE user_id=? AND tutorial_key=?')
    .get(userId, tutorialKey) as any;
  // A stale browser tab must not make a newer tutorial appear unseen again.
  if (current && Number(current.version) > input.version) return progressRow(current);

  const timestamp = new Date().toISOString();
  const isNewVersion = !current || Number(current.version) < input.version;
  const firstOpenedAt = isNewVersion ? timestamp : current.first_opened_at;
  const completedAt = input.status === 'completed'
    ? (!isNewVersion && current.status === 'completed' ? current.completed_at || timestamp : timestamp)
    : null;
  const dismissedAt = input.status === 'dismissed'
    ? (!isNewVersion && current.status === 'dismissed' ? current.dismissed_at || timestamp : timestamp)
    : null;

  db.prepare(`INSERT INTO tutorial_progress
    (user_id,tutorial_key,version,status,last_step,first_opened_at,completed_at,dismissed_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,tutorial_key) DO UPDATE SET
      version=excluded.version,
      status=excluded.status,
      last_step=excluded.last_step,
      first_opened_at=excluded.first_opened_at,
      completed_at=excluded.completed_at,
      dismissed_at=excluded.dismissed_at,
      updated_at=excluded.updated_at`)
    .run(userId, tutorialKey, input.version, input.status, input.lastStep, firstOpenedAt, completedAt, dismissedAt, timestamp);
  return progressRow(db.prepare('SELECT * FROM tutorial_progress WHERE user_id=? AND tutorial_key=?')
    .get(userId, tutorialKey));
});

function account(request: Request, response: Response) {
  const user = currentSessionUser(request);
  if (!user) {
    response.status(401).json({ error: 'Authentication required.', code: 'AUTHENTICATION_REQUIRED' });
    return null;
  }
  return user;
}

export const tutorialProgressRouter = express.Router();
tutorialProgressRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  response.vary('Cookie');
  next();
});

tutorialProgressRouter.get('/progress', (request, response) => {
  const user = account(request, response);
  if (!user) return;
  return response.json({ progress: listTutorialProgress(user.id) });
});

tutorialProgressRouter.put('/progress/:tutorialKey', (request, response) => {
  const user = account(request, response);
  if (!user) return;
  const key = tutorialKeySchema.safeParse(request.params.tutorialKey);
  if (!key.success) {
    return response.status(400).json({ error: 'Unknown tutorial key.', code: 'TUTORIAL_KEY_INVALID' });
  }
  const input = progressInputSchema.safeParse(request.body);
  if (!input.success) {
    return response.status(400).json({
      error: 'Tutorial progress validation failed.',
      code: 'TUTORIAL_PROGRESS_INVALID',
      details: input.error.issues
    });
  }
  return response.json({ progress: saveTutorialProgress(user.id, key.data, input.data) });
});
