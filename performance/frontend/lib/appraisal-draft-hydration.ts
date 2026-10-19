export interface AppraisalDraftBaseline<T> {
  resourceId: string;
  value: T;
}

/** Refresh pristine forms, but never replace edits with a late response for the same review. */
export function hydrateAppraisalDraft<T>(
  routeId: string,
  responseId: string,
  current: T,
  previous: AppraisalDraftBaseline<T> | null,
  incoming: T,
): T {
  if (routeId !== responseId) return current;
  if (!previous || previous.resourceId !== routeId) return incoming;
  return JSON.stringify(current) === JSON.stringify(previous.value) ? incoming : current;
}
