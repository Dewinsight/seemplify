export interface EmailPreviewOrganization {
  name?: string | null;
}

export const EMAIL_PREVIEW_ORGANIZATION_PLACEHOLDER = 'Your organization';

export function resolveEmailPreviewOrganizationName(
  currentOrganization?: EmailPreviewOrganization | null
) {
  return currentOrganization?.name?.trim() || EMAIL_PREVIEW_ORGANIZATION_PLACEHOLDER;
}
