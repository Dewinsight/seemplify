import type { CampaignContact } from '@/types';

export type ImportedCampaignContact = Pick<CampaignContact, 'email' | 'firstName' | 'lastName' | 'jobTitle' | 'company' | 'customData'>;

const headerAliases = {
  email: new Set(['email', 'emailaddress', 'emailid', 'emailaddresswork']),
  firstName: new Set(['firstname', 'givenname', 'forename', 'name']),
  lastName: new Set(['lastname', 'surname', 'familyname']),
  jobTitle: new Set(['jobtitle', 'position', 'role', 'title']),
  company: new Set(['company', 'companyname', 'organisation', 'organization', 'employer'])
};

export function customFieldToken(label: string) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizedHeader(value: string) {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false;
  const commitValue = () => { row.push(value.trim()); value = ''; };
  const commitRow = () => { commitValue(); if (row.some(Boolean)) rows.push(row); row = []; };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) commitValue();
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      commitRow();
    } else value += char;
  }
  if (value || row.length) commitRow();
  return rows;
}

function indexFor(headers: string[], aliases: Set<string>) {
  return headers.findIndex((header) => aliases.has(header));
}

export function contactsFromText(text: string): ImportedCampaignContact[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map(normalizedHeader);
  const hasHeader = indexFor(headers, headerAliases.email) >= 0;
  const emailIndex = hasHeader ? indexFor(headers, headerAliases.email) : 0;
  const firstNameIndex = hasHeader ? indexFor(headers, headerAliases.firstName) : 1;
  const lastNameIndex = hasHeader ? indexFor(headers, headerAliases.lastName) : 2;
  const jobTitleIndex = hasHeader ? indexFor(headers, headerAliases.jobTitle) : 4;
  const companyIndex = hasHeader ? indexFor(headers, headerAliases.company) : 3;
  const knownIndexes = new Set([emailIndex, firstNameIndex, lastNameIndex, jobTitleIndex, companyIndex].filter((index) => index >= 0));
  const customColumns = hasHeader
    ? rows[0].map((label, index) => ({ label: label.replace(/^\uFEFF/, '').trim(), index })).filter(({ label, index }) => label && !knownIndexes.has(index))
    : [];

  return rows.slice(hasHeader ? 1 : 0).map((cells) => {
    const customData = Object.fromEntries(customColumns.flatMap(({ label, index }) => cells[index] ? [[label, cells[index]]] : []));
    return {
      email: cells[emailIndex] || '',
      firstName: firstNameIndex >= 0 ? cells[firstNameIndex] || '' : '',
      lastName: lastNameIndex >= 0 ? cells[lastNameIndex] || '' : '',
      jobTitle: jobTitleIndex >= 0 ? cells[jobTitleIndex] || '' : '',
      company: companyIndex >= 0 ? cells[companyIndex] || '' : '',
      customData
    };
  }).filter((contact) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email));
}
