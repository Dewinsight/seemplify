import { z } from 'zod';

const token = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalText = (maximum: number) => z.string().trim().max(maximum).optional();
const safeKey = z.string().min(1).max(100).regex(/^(?!__proto__$|prototype$|constructor$)[A-Za-z][A-Za-z0-9_.:-]*$/u);
const webhookScalar = z.union([z.string().max(4_000),z.number().finite(),z.boolean(),z.null()]);
const webhookData = z.record(safeKey,z.union([webhookScalar,z.array(webhookScalar).max(100)]))
  .refine((value)=>Object.keys(value).length<=100,'Webhook data has too many fields.')
  .refine((value)=>Buffer.byteLength(JSON.stringify(value),'utf8')<=32_768,'Webhook data is too large.');

const common = { key:token,purpose:text(500),recipientScope:token,
  consequential:z.boolean().optional(),externallyVisible:z.boolean().optional() };

export const workflowActionSchema = z.discriminatedUnion('adapter',[
  z.object({...common,adapter:z.literal('survey_invitation'),payload:z.object({
    surveyId:token,collectorId:token,recipients:z.array(z.object({email:z.string().trim().email().max(320)
      .transform((value)=>value.toLowerCase()),name:optionalText(150)}).strict()).min(1).max(250),
    message:optionalText(3_000)}).strict()}).strict(),
  z.object({...common,adapter:z.literal('service_recovery_ticket'),payload:z.object({
    surveyId:token,responseId:token.nullable().optional(),title:text(700),priority:z.enum(['normal','high','urgent']).optional(),
    owner:optionalText(200),notes:optionalText(4_000)}).strict()}).strict(),
  z.object({...common,adapter:z.literal('assistant_action'),payload:z.object({
    title:text(700),description:optionalText(4_000),owner:optionalText(200),priority:z.enum(['normal','high','urgent']).optional(),
    dueAt:z.string().datetime({offset:true}).nullable().optional()}).strict()}).strict(),
  z.object({...common,adapter:z.literal('internal_notification'),payload:z.object({
    targetUserId:token,title:text(240),body:text(4_000),severity:z.enum(['info','warning','critical'])}).strict()}).strict(),
  z.object({...common,adapter:z.literal('signed_webhook'),payload:z.object({
    destinationId:token,destinationRevision:z.number().int().positive(),eventType:token,data:webhookData}).strict()}).strict()
]);

export type ReviewedWorkflowAction = z.infer<typeof workflowActionSchema>;
