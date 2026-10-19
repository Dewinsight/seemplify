export type SourceType = 'sfia' | 'internal' | 'strategy';
export type Level = {
    id: string;
    label: string;
    description: string;
    order: number;
};
export type NativeCriterion = {
    id: string;
    code: string;
    name: string;
    description: string;
    levelIds: string[];
};
export type RoleCriterion = {
    id: string;
    sourceType: SourceType;
    frameworkVersionId?: string;
    strategyVersionId?: string;
    criterionId: string;
    expectedLevelId?: string;
    evaluationTarget?: {
        scaleId: string;
        value: number;
    };
    weight: number;
    required: boolean;
    evidenceRequired: boolean;
    rationaleRequired: boolean;
    responsibilityIds: string[];
    requirementIds: string[];
};
export type RoleDraft = {
    name: string;
    description: string;
    responsibilities: {
        id: string;
        text: string;
    }[];
    requirements: {
        id: string;
        text: string;
        required: boolean;
    }[];
    criteria: RoleCriterion[];
};
export type Version = Partial<RoleDraft> & {
    id: string;
    versionId: string;
    roleId?: string;
    frameworkId?: string;
    strategyId?: string;
    name: string;
    title?: string;
    description?: string;
    sourceType?: SourceType;
    version: number;
    revision: number;
    status: 'draft' | 'published';
    criteria: any[];
    levels?: Level[];
    source?: string;
    licenseProvenance?: string;
    sourceRef?: {type:'okr';id:string;capturedAt?:string;title?:string}|null;
    createdAt?: string;
    publishedAt?: string;
    publishedBy?: {
        name: string;
    };
};
export type LibraryRecord = {
    id: string;
    revision: number;
    name: string;
    description?: string;
    sourceType?: SourceType;
    archivedAt?: string;
    versions: Version[];
    draftVersion?: Version;
    publishedVersion?: Version;
};
export const sourceLabel = (source: string) => source === 'sfia' ? 'SFIA' : source === 'internal' ? 'Internal competencies' : 'Organisational strategy';
export const key = () => crypto.randomUUID();
