import type { Request, Response } from 'express';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import { config } from './config.js';
import { resolveRequestSpace, SpaceError } from './spaces.js';
import {
  addEnvelopeDocument, authenticateSigningAccessCode, cloneEnvelope, completePublicSigning, consentToElectronicSigning,
  createAccountSavedSignature, createEnvelope, createPublicSavedSignature, declinePublicSigning, deleteAccountSavedSignature,
  deleteEnvelope, deletePublicSavedSignature, EsignError, exchangeSigningToken, getAccountSavedSignatureContent, getEnvelopeDetail,
  getOwnedArtifactContent, getOwnedDocumentContent, getPublicArtifactContent, getPublicDocumentContent, getPublicEnvelope,
  getPublicFieldSignatureContent, getPublicSavedSignatureContent, getRecipientAccountInvitation, getRecipientArtifactContent,
  getSigningSessionSummary, listAccountSavedSignatures, listEnvelopes, listLogModeOutbox, listPublicSavedSignatures,
  listRecipientDocumentActivity, listRecipientDocuments, remindEnvelope, removeEnvelopeDocument,
  replaceAccountSavedSignature, replaceEnvelopeFields, replaceEnvelopeRecipients, replacePublicSavedSignature,
  retryEnvelopeFinalization, revokeSigningSession, savePublicField, sendEnvelope, updateEnvelope,
  verifyPublicCertificate, voidEnvelope
} from './esign.js';

export const esignRouter = express.Router();
export const esignPublicRouter = express.Router();
export const esignRecipientRouter = express.Router();

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.esignMaxDocumentBytes, files: 1, fields: 10 },
  fileFilter: (_request, file, callback) => callback(null, file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname))
});

function actor(request: Request) {
  const user = currentSessionUser(request);
  return { userId: user?.id || null, actorType: 'user' as const, ip: request.ip || null, userAgent: String(request.headers['user-agent'] || '').slice(0, 500) || null };
}
function recipientActor(request: Request) { return { actorType: 'recipient' as const, ip: request.ip || null, userAgent: String(request.headers['user-agent'] || '').slice(0, 500) || null }; }
function authenticatedScope(request: Request) {
  const user = currentSessionUser(request);
  if (!user) throw new EsignError('Authentication required.', 401);
  return { userId: user.id, spaceId: resolveRequestSpace(request, user.id).id };
}
function verifiedRecipientAccount(request: Request) {
  const user = currentSessionUser(request);
  if (!user) throw new EsignError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  if (!user.emailVerifiedAt) throw new EsignError('Verify your email address first.', 403, 'EMAIL_VERIFICATION_REQUIRED');
  return user;
}
function optionalSignatureAccount(request: Request) {
  const user = currentSessionUser(request);
  return user?.emailVerifiedAt ? { userId: user.id, email: user.email } : null;
}
function error(response: Response, caught: unknown) {
  if (caught instanceof z.ZodError) return response.status(400).json({ error: 'Validation failed.', details: caught.issues });
  if (caught instanceof SpaceError) return response.status(caught.status).json({ error: caught.message, code: caught.code });
  if (caught instanceof EsignError) return response.status(caught.status).json({ error: caught.message, code: caught.code });
  console.error('E-sign request failed:', caught);
  return response.status(500).json({ error: 'The e-sign request could not be completed.' });
}
function asyncRoute(handler: (request: Request, response: Response) => Promise<unknown>) {
  return (request: Request, response: Response) => { void handler(request, response).catch((caught) => error(response, caught)); };
}
function parseCookies(request: Request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((part) => part.length === 2));
}
const signingCookieName = 'seemplify_esign_signing';
function signingToken(request: Request) { return parseCookies(request)[signingCookieName] || ''; }
function signingCookie(value: string, maxAgeSeconds: number) {
  return `${signingCookieName}=${encodeURIComponent(value)}; Path=/api/public/esign; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${config.publicUrl.startsWith('https://') ? '; Secure' : ''}`;
}
function fileResponse(response: Response, file: { bytes: Buffer; fileName: string; mimeType: string; sha256: string }, disposition: 'inline' | 'attachment' = 'inline') {
  const ascii = file.fileName.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 150) || 'document.pdf';
  response.setHeader('Content-Type', file.mimeType);
  response.setHeader('Content-Length', String(file.bytes.length));
  response.setHeader('Content-Disposition', `${disposition}; filename="${ascii.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'; sandbox");
  response.setHeader('ETag', `"${file.sha256}"`);
  return response.send(file.bytes);
}

const envelopeInput = z.object({
  title: z.string().trim().min(2).max(180), subject: z.string().trim().max(250).optional(), message: z.string().max(5000).optional(),
  routingMode: z.enum(['sequential', 'parallel']).optional(), expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
  reminderIntervalHours: z.number().int().min(1).max(720).nullable().optional()
});
const recipientInput = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(2).max(150), email: z.string().trim().email().max(254),
  role: z.enum(['signer', 'approver', 'cc', 'viewer']), routingOrder: z.number().int().min(1).max(100),
  accessCode: z.string().trim().min(4).max(64).nullable().optional()
});
const fieldInput = z.object({
  id: z.string().uuid().optional(), documentId: z.string().uuid(), recipientId: z.string().uuid(),
  type: z.enum(['signature', 'initials', 'name', 'email', 'date_signed', 'text', 'checkbox', 'radio', 'dropdown']),
  page: z.number().int().min(1), x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1),
  required: z.boolean().optional(), label: z.string().max(200).optional(), placeholder: z.string().max(200).optional(), tabOrder: z.number().int().min(0).optional(),
  options: z.array(z.string().max(200)).max(50).optional(), validation: z.record(z.string(), z.unknown()).optional()
});
const savedSignatureInput = z.object({
  mode: z.enum(['typed', 'drawn', 'uploaded']),
  label: z.string().trim().max(80).optional(),
  value: z.string().max(100).optional(),
  dataUrl: z.string().max(3_000_000).optional()
}).strict().superRefine((value, context) => {
  if (value.mode === 'typed' && !value.value?.trim()) context.addIssue({ code: 'custom', path: ['value'], message: 'Enter a typed signature.' });
  if (value.mode !== 'typed' && !value.dataUrl) context.addIssue({ code: 'custom', path: ['dataUrl'], message: 'Add a PNG or JPEG signature image.' });
});

esignRouter.use((_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
esignRouter.get('/outbox', (request, response) => { try { const scope = authenticatedScope(request); return response.json(listLogModeOutbox(scope.spaceId, request.query.envelopeId ? String(request.query.envelopeId) : undefined)); } catch (caught) { return error(response, caught); } });
esignRouter.get('/envelopes', (request, response) => { try { const scope = authenticatedScope(request); return response.json(listEnvelopes(scope.spaceId, Number(request.query.limit || 200))); } catch (caught) { return error(response, caught); } });
esignRouter.post('/envelopes', (request, response) => { try { const scope = authenticatedScope(request); const input = envelopeInput.parse(request.body); return response.status(201).json(createEnvelope(scope.spaceId, scope.userId, input, actor(request))); } catch (caught) { return error(response, caught); } });
esignRouter.get('/envelopes/:id', (request, response) => { try { const scope = authenticatedScope(request); return response.json(getEnvelopeDetail(String(request.params.id), scope.spaceId)); } catch (caught) { return error(response, caught); } });
esignRouter.patch('/envelopes/:id', (request, response) => { try { const scope = authenticatedScope(request); const input = envelopeInput.partial().parse(request.body); return response.json(updateEnvelope(String(request.params.id), scope.spaceId, scope.userId, input, actor(request))); } catch (caught) { return error(response, caught); } });
esignRouter.delete('/envelopes/:id', (request, response) => { try { const scope = authenticatedScope(request); return deleteEnvelope(String(request.params.id), scope.spaceId) ? response.status(204).end() : response.status(404).json({ error: 'Envelope not found.' }); } catch (caught) { return error(response, caught); } });
esignRouter.post('/envelopes/:id/documents', pdfUpload.single('file'), asyncRoute(async (request, response) => {
  const scope = authenticatedScope(request);
  if (!request.file) throw new EsignError('Choose a PDF document.');
  return response.status(201).json(await addEnvelopeDocument(String(request.params.id), scope.spaceId, scope.userId, request.file, actor(request)));
}));
esignRouter.get('/envelopes/:id/documents/:documentId/content', (request, response) => { try { const scope = authenticatedScope(request); return fileResponse(response, getOwnedDocumentContent(String(request.params.id), String(request.params.documentId), scope.spaceId)); } catch (caught) { return error(response, caught); } });
esignRouter.delete('/envelopes/:id/documents/:documentId', (request, response) => { try { const scope = authenticatedScope(request); removeEnvelopeDocument(String(request.params.id), String(request.params.documentId), scope.spaceId, scope.userId, actor(request)); return response.status(204).end(); } catch (caught) { return error(response, caught); } });
esignRouter.put('/envelopes/:id/recipients', (request, response) => { try { const scope = authenticatedScope(request); const input = z.object({ recipients: z.array(recipientInput).max(100) }).parse(request.body); return response.json(replaceEnvelopeRecipients(String(request.params.id), scope.spaceId, scope.userId, input.recipients, actor(request))); } catch (caught) { return error(response, caught); } });
esignRouter.put('/envelopes/:id/fields', (request, response) => { try { const scope = authenticatedScope(request); const input = z.object({ fields: z.array(fieldInput).max(1000) }).parse(request.body); return response.json(replaceEnvelopeFields(String(request.params.id), scope.spaceId, scope.userId, input.fields, actor(request))); } catch (caught) { return error(response, caught); } });
esignRouter.post('/envelopes/:id/send', (request, response) => { try { const scope = authenticatedScope(request); return response.json(sendEnvelope(String(request.params.id), scope.spaceId, scope.userId, actor(request))); } catch (caught) { return error(response, caught); } });
esignRouter.post('/envelopes/:id/remind', (request, response) => { try { const scope = authenticatedScope(request); const input = z.object({ recipientId: z.string().uuid().optional() }).parse(request.body || {}); return response.status(202).json(remindEnvelope(String(request.params.id), scope.spaceId, scope.userId, input.recipientId, actor(request))); } catch (caught) { return error(response, caught); } });
esignRouter.post('/envelopes/:id/recipients/:recipientId/resend', (request, response) => { try { const scope = authenticatedScope(request); return response.status(202).json(remindEnvelope(String(request.params.id), scope.spaceId, scope.userId, String(request.params.recipientId), actor(request))); } catch (caught) { return error(response, caught); } });
esignRouter.post('/envelopes/:id/void', (request, response) => { try { const scope = authenticatedScope(request); const input = z.object({ reason: z.string().trim().min(2).max(1000) }).parse(request.body); return response.json(voidEnvelope(String(request.params.id), scope.spaceId, scope.userId, input.reason, actor(request))); } catch (caught) { return error(response, caught); } });
esignRouter.post('/envelopes/:id/clone', (request, response) => { try { const scope = authenticatedScope(request); const input = z.object({ title: z.string().trim().min(2).max(180).optional() }).parse(request.body || {}); return response.status(201).json(cloneEnvelope(String(request.params.id), scope.spaceId, scope.userId, input.title, actor(request))); } catch (caught) { return error(response, caught); } });
esignRouter.post('/envelopes/:id/retry-finalization', (request, response) => { try { const scope = authenticatedScope(request); return response.status(202).json(retryEnvelopeFinalization(String(request.params.id), scope.spaceId, scope.userId, actor(request))); } catch (caught) { return error(response, caught); } });
esignRouter.get('/envelopes/:id/artifacts/:artifactId/content', (request, response) => { try { const scope = authenticatedScope(request); return fileResponse(response, getOwnedArtifactContent(String(request.params.id), String(request.params.artifactId), scope.spaceId), 'attachment'); } catch (caught) { return error(response, caught); } });

esignRecipientRouter.use((_request, response, next) => { response.setHeader('Cache-Control', 'private, no-store'); next(); });
esignRecipientRouter.get('/', (request, response) => {
  try {
    const user = verifiedRecipientAccount(request);
    return response.json(listRecipientDocuments(user.email, Number(request.query.limit || 200)));
  } catch (caught) { return error(response, caught); }
});
esignRecipientRouter.get('/signatures', (request, response) => {
  try { const user = verifiedRecipientAccount(request); return response.json(listAccountSavedSignatures(user.id)); }
  catch (caught) { return error(response, caught); }
});
esignRecipientRouter.post('/signatures', asyncRoute(async (request, response) => {
  const user = verifiedRecipientAccount(request); const input = savedSignatureInput.parse(request.body);
  return response.status(201).json(await createAccountSavedSignature(user.id, user.email, input, actor(request)));
}));
esignRecipientRouter.put('/signatures/:id', asyncRoute(async (request, response) => {
  const user = verifiedRecipientAccount(request); const input = savedSignatureInput.parse(request.body);
  return response.json(await replaceAccountSavedSignature(user.id, String(request.params.id), input, actor(request)));
}));
esignRecipientRouter.delete('/signatures/:id', (request, response) => {
  try { const user = verifiedRecipientAccount(request); deleteAccountSavedSignature(user.id, String(request.params.id), actor(request)); return response.status(204).end(); }
  catch (caught) { return error(response, caught); }
});
esignRecipientRouter.get('/signatures/:id/content', (request, response) => {
  try { const user = verifiedRecipientAccount(request); return fileResponse(response, getAccountSavedSignatureContent(user.id, String(request.params.id))); }
  catch (caught) { return error(response, caught); }
});
esignRecipientRouter.get('/envelopes/:id/activity', (request, response) => {
  try {
    const user = verifiedRecipientAccount(request);
    return response.json(listRecipientDocumentActivity(user.email, String(request.params.id), Number(request.query.limit || 100)));
  } catch (caught) { return error(response, caught); }
});
esignRecipientRouter.get('/envelopes/:id/artifacts/:artifactId/content', (request, response) => {
  try {
    const user = verifiedRecipientAccount(request);
    return fileResponse(response, getRecipientArtifactContent(user.email, String(request.params.id), String(request.params.artifactId), {
      userId: user.id, actorType: 'user', ip: request.ip || null,
      userAgent: String(request.headers['user-agent'] || '').slice(0, 500) || null
    }), 'attachment');
  } catch (caught) { return error(response, caught); }
});

esignPublicRouter.use((_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer'); next(); });
esignPublicRouter.get('/account-invitations/:token', (request, response) => { try { return response.json(getRecipientAccountInvitation(String(request.params.token))); } catch (caught) { return error(response, caught); } });
esignPublicRouter.get('/certificates/:publicId', (request, response) => { try { return response.json(verifyPublicCertificate(String(request.params.publicId))); } catch (caught) { return error(response, caught); } });
esignPublicRouter.post('/session', (request, response) => {
  try {
    const { token } = z.object({ token: z.string().min(30).max(100) }).parse(request.body);
    const result = exchangeSigningToken(token, recipientActor(request));
    response.setHeader('Set-Cookie', signingCookie(result.sessionToken, config.esignSigningSessionHours * 3600));
    return response.status(201).json(result.snapshot);
  } catch (caught) { return error(response, caught); }
});
esignPublicRouter.get('/session', (request, response) => { try { return response.json(getSigningSessionSummary(signingToken(request))); } catch (caught) { return error(response, caught); } });
esignPublicRouter.post('/logout', (request, response) => { revokeSigningSession(signingToken(request)); response.setHeader('Set-Cookie', signingCookie('', 0)); return response.status(204).end(); });
esignPublicRouter.get('/envelope', (request, response) => { try { return response.json(getPublicEnvelope(signingToken(request))); } catch (caught) { return error(response, caught); } });
esignPublicRouter.post('/access-code', (request, response) => { try { const { code } = z.object({ code: z.string().min(1).max(64) }).parse(request.body); return response.json(authenticateSigningAccessCode(signingToken(request), code, recipientActor(request))); } catch (caught) { return error(response, caught); } });
esignPublicRouter.post('/consent', (request, response) => { try { const { agreed } = z.object({ agreed: z.literal(true) }).parse(request.body); return response.json(consentToElectronicSigning(signingToken(request), agreed, recipientActor(request))); } catch (caught) { return error(response, caught); } });
esignPublicRouter.get('/signatures', (request, response) => {
  try { return response.json(listPublicSavedSignatures(signingToken(request), optionalSignatureAccount(request))); }
  catch (caught) { return error(response, caught); }
});
esignPublicRouter.post('/signatures', asyncRoute(async (request, response) => {
  const input = savedSignatureInput.parse(request.body);
  return response.status(201).json(await createPublicSavedSignature(signingToken(request), input, optionalSignatureAccount(request), recipientActor(request)));
}));
esignPublicRouter.put('/signatures/:id', asyncRoute(async (request, response) => {
  const input = savedSignatureInput.parse(request.body);
  return response.json(await replacePublicSavedSignature(signingToken(request), String(request.params.id), input, optionalSignatureAccount(request), recipientActor(request)));
}));
esignPublicRouter.delete('/signatures/:id', (request, response) => {
  try { deletePublicSavedSignature(signingToken(request), String(request.params.id), optionalSignatureAccount(request), recipientActor(request)); return response.status(204).end(); }
  catch (caught) { return error(response, caught); }
});
esignPublicRouter.get('/signatures/:id/content', (request, response) => {
  try { return fileResponse(response, getPublicSavedSignatureContent(signingToken(request), String(request.params.id), optionalSignatureAccount(request))); }
  catch (caught) { return error(response, caught); }
});
esignPublicRouter.put('/fields/:fieldId', asyncRoute(async (request, response) => {
  const input = z.object({
    value: z.unknown().optional(),
    signature: z.object({ mode: z.enum(['typed', 'drawn', 'uploaded']), value: z.string().max(100).optional(), dataUrl: z.string().max(3_000_000).optional() }).optional(),
    savedSignatureId: z.string().uuid().optional()
  }).superRefine((value, context) => {
    const supplied = [value.value !== undefined, value.signature !== undefined, value.savedSignatureId !== undefined].filter(Boolean).length;
    if (supplied !== 1) context.addIssue({ code: 'custom', message: 'Provide exactly one field value or signature source.' });
  }).parse(request.body);
  return response.json(await savePublicField(signingToken(request), String(request.params.fieldId), input, recipientActor(request), optionalSignatureAccount(request)));
}));
esignPublicRouter.get('/fields/:fieldId/signature/content', (request, response) => {
  try { return fileResponse(response, getPublicFieldSignatureContent(signingToken(request), String(request.params.fieldId))); }
  catch (caught) { return error(response, caught); }
});
esignPublicRouter.post('/complete', (request, response) => { try { return response.json(completePublicSigning(signingToken(request), recipientActor(request))); } catch (caught) { return error(response, caught); } });
esignPublicRouter.post('/decline', (request, response) => { try { const { reason } = z.object({ reason: z.string().trim().min(2).max(1000) }).parse(request.body); return response.json(declinePublicSigning(signingToken(request), reason, recipientActor(request))); } catch (caught) { return error(response, caught); } });
esignPublicRouter.get('/documents/:documentId/content', (request, response) => { try { return fileResponse(response, getPublicDocumentContent(signingToken(request), String(request.params.documentId))); } catch (caught) { return error(response, caught); } });
esignPublicRouter.get('/artifacts/:artifactId/content', (request, response) => { try { return fileResponse(response, getPublicArtifactContent(signingToken(request), String(request.params.artifactId)), 'attachment'); } catch (caught) { return error(response, caught); } });
