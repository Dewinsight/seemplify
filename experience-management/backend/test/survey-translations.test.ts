import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-survey-translations-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const webhookSecretFile = path.join(root, 'brevo-webhook-secret');
const xKeyFile = path.join(root, 'x-credential-encryption-key');
const esignKeyFile = path.join(root, 'esign-encryption-key');
const frontendDist = path.join(root, 'frontend');
fs.mkdirSync(frontendDist, { recursive: true });
fs.writeFileSync(path.join(frontendDist, 'index.html'), '<!doctype html><title>Translation regression test</title>');
fs.writeFileSync(passwordFile, 'Test-Admin-Password-2026!');
fs.writeFileSync(sessionFile, 'test-session-secret-that-is-long-and-random-enough');
fs.writeFileSync(webhookSecretFile, 'test-brevo-webhook-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 9).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 10).toString('base64url'));

Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: frontendDist,
  PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'qa@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile,
  EMAIL_MODE: 'log',
  LOCAL_LLM_SHARED_SECRET_FILE: sessionFile,
  BREVO_WEBHOOK_SECRET_FILE: webhookSecretFile,
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile,
  X_API_BASE_URL: 'https://api.x.invalid',
  X_OAUTH_BASE_URL: 'https://api.x.invalid',
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile,
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'no-x-consumer-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'no-x-consumer-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'no-x-bearer-token'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'no-x-access-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'no-x-access-token-secret')
});

const { app } = await import('../src/app.js');
const { applySurveyTranslation, db, getSurvey, listInsights } = await import('../src/database.js');
const { createAiJobFixture } = await import('./aiJobFixtures.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('a stale Studio save does not erase a completed AI translation', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'qa@seemplify.local',
    password: 'Test-Admin-Password-2026!'
  }).expect(200);

  const created = await agent.post('/api/surveys').send({
    title: 'Translation preservation regression',
    description: 'Original description',
    settings: { showProgress: true },
    questions: [{ type: 'short_text', title: 'What should we improve?', required: true }]
  }).expect(201);
  const staleStudioDraft = structuredClone(created.body);
  const frenchTranslation = {
    language: 'French',
    title: 'Regression de conservation de la traduction',
    description: 'Description traduite',
    thankYouMessage: 'Merci pour votre retour.',
    questions: [{
      questionId: created.body.questions[0].id,
      title: 'Que devons-nous ameliorer ?',
      description: '',
      options: []
    }]
  };

  // Simulate survey.translate finishing after Studio loaded its editable draft.
  db.prepare('UPDATE surveys SET settings_json=? WHERE id=?').run(JSON.stringify({
    ...created.body.settings,
    translations: { French: frenchTranslation }
  }), created.body.id);

  const saved = await agent.put(`/api/surveys/${created.body.id}`).send({
    ...staleStudioDraft,
    description: 'Edited later from the stale Studio draft',
    settings: { ...staleStudioDraft.settings, showProgress: false }
  }).expect(200);

  assert.equal(saved.body.description, 'Edited later from the stale Studio draft');
  assert.equal(saved.body.settings.showProgress, false);
  assert.deepEqual(saved.body.settings.translations?.French, frenchTranslation);

  const reloaded = await agent.get(`/api/surveys/${created.body.id}`).expect(200);
  assert.deepEqual(reloaded.body.survey.settings.translations?.French, frenchTranslation);
});

test('translation completion merges into the newest survey and replays idempotently', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'qa@seemplify.local',
    password: 'Test-Admin-Password-2026!'
  }).expect(200);

  const created = await agent.post('/api/surveys').send({
    title: 'Title seen when Terra started',
    description: 'Original description',
    settings: { showProgress: true },
    questions: [{ type: 'short_text', title: 'Original question', required: true }]
  }).expect(201);
  const spaceId = String((db.prepare('SELECT space_id FROM surveys WHERE id=?').get(created.body.id) as any).space_id);
  const job = createAiJobFixture('survey.translate', { language: 'Spanish' }, spaceId, created.body.id, null, null);

  const edited = await agent.put(`/api/surveys/${created.body.id}`).send({
    ...created.body,
    title: 'Newest title saved while Terra was running',
    description: 'Newest description',
    questions: [{
      ...created.body.questions[0],
      title: 'Newest question saved while Terra was running'
    }]
  }).expect(200);
  const spanishTranslation = {
    language: 'Spanish',
    title: 'Titulo traducido',
    description: 'Descripcion traducida',
    thankYouMessage: 'Gracias.',
    questions: [{
      questionId: edited.body.questions[0].id,
      title: 'Pregunta traducida',
      description: '',
      options: []
    }]
  };

  const applied = applySurveyTranslation({
    aiJobId: job.id,
    surveyId: created.body.id,
    spaceId,
    language: 'Spanish',
    translation: spanishTranslation
  });
  assert.ok(applied);
  assert.equal(applied.survey.title, 'Newest title saved while Terra was running');
  assert.equal(applied.survey.description, 'Newest description');
  assert.equal(applied.survey.questions[0].title, 'Newest question saved while Terra was running');
  assert.deepEqual(applied.survey.settings.translations?.Spanish, spanishTranslation);
  assert.deepEqual(applied.insight.payload, spanishTranslation);

  const unexpectedReplayTranslation = {
    ...spanishTranslation,
    title: 'A replay must not replace the original translation'
  };
  const replayed = applySurveyTranslation({
    aiJobId: job.id,
    surveyId: created.body.id,
    spaceId,
    language: 'Spanish',
    translation: unexpectedReplayTranslation
  });
  assert.equal(replayed?.insight.id, applied.insight.id);
  const translationInsights = listInsights(created.body.id).filter((insight) => insight.kind === 'translation');
  assert.equal(translationInsights.length, 1);
  assert.deepEqual(translationInsights[0].payload, spanishTranslation);
  assert.deepEqual(replayed?.survey.settings.translations?.Spanish, spanishTranslation);

  const reloaded = getSurvey(created.body.id, spaceId);
  assert.equal(reloaded?.title, 'Newest title saved while Terra was running');
  assert.equal(reloaded?.questions[0].title, 'Newest question saved while Terra was running');
  assert.deepEqual(reloaded?.settings.translations?.Spanish, spanishTranslation);
});
