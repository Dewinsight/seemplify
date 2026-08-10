import { z } from 'zod';
import { api, json } from '@/lib/api';

export const predictionTargets = ['churn', 'conversion'] as const;
export const evaluatorKinds = ['governed_fixture'] as const;
const windowSchema=z.object({from:z.string(),to:z.string()}).strict();
export const policySchema=z.object({enabled:z.boolean(),purpose:z.string(),minimumTrainingSamples:z.number(),minimumClassSamples:z.number(),
  minimumValidationSamples:z.number(),minimumAreaUnderRoc:z.number(),maximumBrierScore:z.number(),maximumPopulationStabilityIndex:z.number(),
  maximumMissingFeatureRatio:z.number(),maximumOutOfDistributionScore:z.number()}).strict();
const modelEvidence=z.object({id:z.string(),target:z.enum(predictionTargets),version:z.string(),state:z.enum(['approved','retired']),
  trainingWindow:windowSchema,validationWindow:windowSchema,trainingSamples:z.number(),positiveSamples:z.number(),negativeSamples:z.number(),
  validationSamples:z.number(),areaUnderRoc:z.number(),brierScore:z.number(),featureNames:z.array(z.string()),trainedByUserId:z.string(),
  approvedByUserId:z.string(),approvedAt:z.string(),contentSha256:z.string()}).strict();
const modelSummary=z.object({id:z.string(),target:z.enum(predictionTargets),name:z.string(),state:z.enum(['approved','retired']),revision:z.number(),
  currentVersionId:z.string(),createdAt:z.string(),updatedAt:z.string()}).strict();
const policyRecord=z.object({target:z.enum(predictionTargets),policy:policySchema,revision:z.number(),updatedAt:z.string().nullable()}).strict();
const modelDetail=z.object({model:modelSummary,versions:z.array(z.object({id:z.string(),model:modelEvidence,contentSha256:z.string(),approvedAt:z.string()}).strict())}).strict();
const result=z.object({decision:z.enum(['predicted','abstained']),target:z.enum(predictionTargets),modelId:z.string(),modelVersion:z.string(),
  modelContentSha256:z.string(),subjectRefSha256:z.string(),sourceWindow:windowSchema,score:z.number().nullable(),confidence:z.number().nullable(),
  reasonCodes:z.array(z.string()),limitations:z.array(z.string()),explanation:z.array(z.object({feature:z.string(),contribution:z.number(),
    direction:z.enum(['increases','decreases','neutral'])}).strict())}).strict();
const run=z.object({id:z.string(),modelId:z.string(),modelVersionId:z.string(),evaluatorKind:z.enum(evaluatorKinds),evaluatorOutputSha256:z.string(),
  result,resultSha256:z.string(),createdAt:z.string()}).strict();

export type PredictionPolicy=z.infer<typeof policySchema>;
export type PredictionPolicyRecord=z.infer<typeof policyRecord>;
export type PredictiveModelSummary=z.infer<typeof modelSummary>;
export type PredictiveModelDetail=z.infer<typeof modelDetail>;
export type PredictionRun=z.infer<typeof run>;
export type PredictionTarget=typeof predictionTargets[number];
export type ModelApprovalInput={name:string;model:{id:string;target:PredictionTarget;version:string;trainingWindow:{from:string;to:string};
  validationWindow:{from:string;to:string};trainingSamples:number;positiveSamples:number;negativeSamples:number;validationSamples:number;
  areaUnderRoc:number;brierScore:number;featureNames:string[];trainedByUserId:string}};
export type EvaluationInput={modelVersionId:string;evaluatorKind:typeof evaluatorKinds[number];request:{subjectId:string;purpose:string;optedIn:boolean;
  consentAllowed:boolean;sourceWindow:{from:string;to:string};score:number|null;confidence:number|null;featureValues:Record<string,number|null>;
  featureContributions:Record<string,number>}};

async function parsed<T>(schema:z.ZodType<T>,path:string,options?:RequestInit){return schema.parse(await api<unknown>(path,options));}
export const listPredictiveGovernance=()=>parsed(z.object({models:z.array(modelSummary),policies:z.array(policyRecord)}).strict(),'/api/journey-predictive-governance');
export const readPredictiveModel=(modelId:string)=>parsed(modelDetail,`/api/journey-predictive-governance/models/${encodeURIComponent(modelId)}`);
export const approvePredictiveModel=(input:ModelApprovalInput)=>parsed(modelDetail,'/api/journey-predictive-governance/models',json('POST',input));
export const retirePredictiveModel=(model:PredictiveModelSummary)=>parsed(modelSummary,`/api/journey-predictive-governance/models/${encodeURIComponent(model.id)}/retire`,json('POST',{expectedRevision:model.revision}));
export const updatePredictionPolicy=(record:PredictionPolicyRecord,policy:PredictionPolicy)=>parsed(policyRecord,
  `/api/journey-predictive-governance/policies/${record.target}`,json('PUT',{expectedRevision:record.revision,policy}));
export const recordDriftEvaluation=(modelId:string,versionId:string,input:{populationStabilityIndex:number|null;missingFeatureRatio:number;outOfDistributionScore:number|null})=>
  parsed(z.object({id:z.string(),modelId:z.string(),modelVersionId:z.string(),decision:z.enum(['within_envelope','abstain']),reasonCodes:z.array(z.string()),evaluatedAt:z.string()}).strict(),
    `/api/journey-predictive-governance/models/${encodeURIComponent(modelId)}/versions/${encodeURIComponent(versionId)}/drift-evaluations`,json('POST',input));
export const evaluatePrediction=(input:EvaluationInput)=>parsed(z.object({id:z.string(),result,evaluatorKind:z.enum(evaluatorKinds),
  evaluatorOutputSha256:z.string(),createdAt:z.string()}).strict(),'/api/journey-predictive-governance/evaluations',json('POST',input));
export const listPredictionRuns=()=>parsed(z.object({runs:z.array(run)}).strict(),'/api/journey-predictive-governance/runs?limit=100').then(value=>value.runs);
