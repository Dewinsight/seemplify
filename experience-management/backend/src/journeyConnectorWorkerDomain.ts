import crypto from 'node:crypto';

export const journeyConnectorWorkerAdapters = ['service_recovery_tickets_v1'] as const;
export type JourneyConnectorWorkerAdapter = typeof journeyConnectorWorkerAdapters[number];
export type JourneyConnectorWorkerPrincipal = Readonly<{ principalId:string; keyId:string; allowedSpaceIds:readonly string[];
  allowedConnectorIds:readonly string[]; allowedAdapters:readonly JourneyConnectorWorkerAdapter[]; issuedAt:string; expiresAt:string }>;

export class JourneyConnectorWorkerError extends Error {
  constructor(message:string, public code='JOURNEY_CONNECTOR_WORKER_DENIED', public status=403) { super(message); this.name='JourneyConnectorWorkerError'; }
}

const identifier=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const timestamp=(value:string)=>Number.isFinite(Date.parse(value));
const unique=(values:readonly string[])=>new Set(values).size===values.length;
export function assertConnectorWorkerScope(input:{principal:JourneyConnectorWorkerPrincipal;spaceId:string;connectorId:string;
  adapter:JourneyConnectorWorkerAdapter;at:string}) {
  if(!timestamp(input.at)||Date.parse(input.at)<Date.parse(input.principal.issuedAt)||Date.parse(input.at)>=Date.parse(input.principal.expiresAt))
    throw new JourneyConnectorWorkerError('Worker authority is outside its validity window.','JOURNEY_CONNECTOR_WORKER_EXPIRED',401);
  if(!input.principal.allowedSpaceIds.includes(input.spaceId)||!input.principal.allowedConnectorIds.includes(input.connectorId)
    ||!input.principal.allowedAdapters.includes(input.adapter))
    throw new JourneyConnectorWorkerError('Worker authority does not cover this connector.','JOURNEY_CONNECTOR_WORKER_SCOPE_DENIED');
}

type Claims={v:1;sub:string;kid:string;spaces:string[];connectors:string[];adapters:JourneyConnectorWorkerAdapter[];iat:string;exp:string};
const b64=(value:string)=>Buffer.from(value).toString('base64url');
export function mintConnectorWorkerCredential(input:{principalId:string;keyId:string;allowedSpaceIds:string[];allowedConnectorIds:string[];
  allowedAdapters:JourneyConnectorWorkerAdapter[];issuedAt:string;expiresAt:string;secret:string}) {
  if(!identifier.test(input.principalId)||!identifier.test(input.keyId)||input.secret.length<32||!timestamp(input.issuedAt)||!timestamp(input.expiresAt)
    ||Date.parse(input.expiresAt)<=Date.parse(input.issuedAt)||!input.allowedSpaceIds.length||input.allowedSpaceIds.length>100
    ||!input.allowedConnectorIds.length||input.allowedConnectorIds.length>200||!input.allowedAdapters.length
    ||![...input.allowedSpaceIds,...input.allowedConnectorIds].every((v)=>identifier.test(v))
    ||!unique(input.allowedSpaceIds)||!unique(input.allowedConnectorIds)||!unique(input.allowedAdapters))
    throw new JourneyConnectorWorkerError('Worker credential claims are invalid.','JOURNEY_CONNECTOR_WORKER_CLAIMS_INVALID',400);
  const claims:Claims={v:1,sub:input.principalId,kid:input.keyId,spaces:[...input.allowedSpaceIds].sort(),
    connectors:[...input.allowedConnectorIds].sort(),adapters:[...input.allowedAdapters].sort() as JourneyConnectorWorkerAdapter[],
    iat:input.issuedAt,exp:input.expiresAt};
  const body=b64(JSON.stringify(claims)); const signature=crypto.createHmac('sha256',input.secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}
export function authenticateConnectorWorkerCredential(input:{credential:string;secret:string;at:string}):JourneyConnectorWorkerPrincipal {
  const [body,signature,extra]=input.credential.split('.');
  if(!body||!signature||extra||input.secret.length<32) throw new JourneyConnectorWorkerError('Worker credential is malformed.','JOURNEY_CONNECTOR_WORKER_AUTH_INVALID',401);
  const expected=crypto.createHmac('sha256',input.secret).update(body).digest(); let received:Buffer;
  try{received=Buffer.from(signature,'base64url');}catch{throw new JourneyConnectorWorkerError('Worker credential is malformed.','JOURNEY_CONNECTOR_WORKER_AUTH_INVALID',401);}
  if(received.length!==expected.length||!crypto.timingSafeEqual(received,expected)) throw new JourneyConnectorWorkerError('Worker credential signature is invalid.','JOURNEY_CONNECTOR_WORKER_AUTH_INVALID',401);
  let claims:Claims; try{claims=JSON.parse(Buffer.from(body,'base64url').toString()) as Claims;}catch{throw new JourneyConnectorWorkerError('Worker credential claims are invalid.','JOURNEY_CONNECTOR_WORKER_AUTH_INVALID',401);}
  if(claims.v!==1||!identifier.test(claims.sub)||!identifier.test(claims.kid)||!Array.isArray(claims.spaces)
    ||!Array.isArray(claims.connectors)||!Array.isArray(claims.adapters)||!claims.spaces.length||claims.spaces.length>100
    ||!claims.connectors.length||claims.connectors.length>200||!claims.adapters.length
    ||![...claims.spaces,...claims.connectors].every((v)=>typeof v==='string'&&identifier.test(v))
    ||!claims.adapters.every((v)=>journeyConnectorWorkerAdapters.includes(v))||!unique(claims.spaces)||!unique(claims.connectors)
    ||!unique(claims.adapters)||!timestamp(claims.iat)||!timestamp(claims.exp)||Date.parse(input.at)<Date.parse(claims.iat)
    ||Date.parse(input.at)>=Date.parse(claims.exp)) throw new JourneyConnectorWorkerError('Worker credential claims are invalid or expired.','JOURNEY_CONNECTOR_WORKER_AUTH_INVALID',401);
  return Object.freeze({principalId:claims.sub,keyId:claims.kid,allowedSpaceIds:Object.freeze([...claims.spaces]),
    allowedConnectorIds:Object.freeze([...claims.connectors]),allowedAdapters:Object.freeze([...claims.adapters]),issuedAt:claims.iat,expiresAt:claims.exp});
}

export function ticketConnectorPayload(row:{surveyId:string;priority:string;status:string;createdAt:string;updatedAt:string}) {
  return Object.freeze({schemaVersion:1,sourceType:'service_recovery_ticket',surveyId:row.surveyId,
    priority:row.priority,status:row.status,createdAt:row.createdAt,updatedAt:row.updatedAt});
}
