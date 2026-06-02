const mongoose = require('mongoose');
require('dotenv').config();

const Organization = require('../models/Organization');
const OnboardingDocumentTemplate = require('../models/OnboardingDocumentTemplate');

const dryRun = process.argv.includes('--dry-run');
const seedAkwaIbomForAll = process.argv.includes('--akwa-ibom-for-all');
const seedOnlyAkwaIbom = process.argv.includes('--only-akwa-ibom');

const standardVariables = [
  'candidate.name',
  'candidate.firstName',
  'candidate.position',
  'organization.name',
  'recruiter.name',
  'today'
];

const defaultTemplates = [
  {
    name: 'Offer Letter',
    category: 'offer',
    description: 'Standard candidate offer letter with candidate signature.',
    text: 'Dear {{candidate.name}},\n\nWe are pleased to offer you the {{candidate.position}} role at {{organization.name}}. This offer is subject to satisfactory completion of onboarding documentation and internal approvals.\n\nPlease review and sign below to acknowledge receipt of this offer.'
  },
  {
    name: 'NDA and Confidentiality Agreement',
    category: 'nda',
    description: 'Confidentiality agreement for candidates before joining.',
    text: 'This confidentiality agreement is between {{organization.name}} and {{candidate.name}}.\n\nThe candidate agrees to protect confidential information received during onboarding, interviews, and pre-employment activities.'
  },
  {
    name: 'Candidate Consent and Privacy Notice',
    category: 'privacy',
    description: 'Consent notice for candidate data processing.',
    text: 'By signing this notice, {{candidate.name}} confirms consent for {{organization.name}} to process onboarding information, identity details, and documentation for recruitment and onboarding purposes.'
  },
  {
    name: 'Contractor Agreement',
    category: 'contract',
    description: 'Simple contractor onboarding agreement.',
    text: 'This contractor agreement records the onboarding terms between {{organization.name}} and {{candidate.name}}. Specific commercial terms should be reviewed and completed before sending.'
  },
  {
    name: 'Employment Agreement',
    category: 'agreement',
    description: 'Employment onboarding agreement template.',
    text: 'This employment agreement sets out the initial onboarding terms for {{candidate.name}} at {{organization.name}}. Please review all sections before signing.'
  },
  {
    name: 'Onboarding Checklist',
    category: 'checklist',
    description: 'Candidate-facing checklist acknowledgement.',
    text: 'I, {{candidate.name}}, acknowledge that I have received the onboarding checklist from {{organization.name}} and will complete the requested documents digitally.'
  }
];

function signatureField({
  id,
  role = 'candidate',
  type = 'signature',
  label,
  signerKey,
  page = 1,
  x,
  y,
  width,
  height,
  required = true
}) {
  return {
    id,
    role,
    type,
    label,
    signerKey,
    page,
    x,
    y,
    width,
    height,
    required
  };
}

const signatureFields = [
  signatureField({
    id: 'candidate-signature',
    role: 'candidate',
    type: 'signature',
    label: 'Candidate signature',
    page: 1,
    x: 0.12,
    y: 0.78,
    width: 0.32,
    height: 0.08
  }),
  signatureField({
    id: 'candidate-date',
    role: 'candidate',
    type: 'date',
    label: 'Date signed',
    page: 1,
    x: 0.52,
    y: 0.78,
    width: 0.22,
    height: 0.05
  })
];

function internalSignatureFields(prefix, signerKey, label, y = 0.84) {
  return [
    signatureField({
      id: `${prefix}-internal-signature`,
      role: 'internal',
      type: 'signature',
      label,
      signerKey,
      page: 1,
      x: 0.12,
      y,
      width: 0.32,
      height: 0.08
    }),
    signatureField({
      id: `${prefix}-internal-date`,
      role: 'internal',
      type: 'date',
      label: 'Date signed',
      signerKey,
      page: 1,
      x: 0.52,
      y,
      width: 0.22,
      height: 0.05
    })
  ];
}

function block(prefix, index, type, content, style = {}) {
  return {
    id: `${prefix}-${String(index).padStart(2, '0')}-${type}`,
    type,
    content,
    style
  };
}

function textBlock(prefix, index, text, style = {}) {
  return block(prefix, index, 'text', { text }, style);
}

function sectionBlock(prefix, index, title, text, style = {}) {
  return block(prefix, index, 'section', { title, text }, style);
}

function tableBlock(prefix, index, rows, style = {}) {
  return block(prefix, index, 'table', { rows }, {
    padding: 7,
    fontSize: 9,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    ...style
  });
}

function spacerBlock(prefix, index, height = 16) {
  return block(prefix, index, 'spacer', { height });
}

function signatureBlock(prefix, index, label = 'Signature') {
  return block(prefix, index, 'signature', { label }, {
    padding: 0,
    borderWidth: 0
  });
}

function aksHeaderBlocks(prefix, title, formCode) {
  return [
    block(prefix, 1, 'logo', {
      text: 'Government of Akwa Ibom State',
      alt: 'Government of Akwa Ibom State',
      width: 260,
      height: 52
    }, {
      align: 'center',
      fontWeight: 'bold',
      fontSize: 13,
      color: '#14532d',
      borderWidth: 1,
      borderColor: '#d9b64e',
      borderRadius: 6,
      padding: 8
    }),
    block(prefix, 2, 'heading', { text: title }, {
      align: 'center',
      fontWeight: 'bold',
      fontSize: 20,
      color: '#0f172a'
    }),
    textBlock(prefix, 3, `Office of the Head of Civil Service\nAKS-HRMS - ${formCode}`, {
      align: 'center',
      fontWeight: '600',
      color: '#475569'
    }),
    spacerBlock(prefix, 4, 10)
  ];
}

function aksTemplate({ name, description, formCode, prefix, blocks, fields = signatureFields }) {
  return {
    name,
    category: 'custom',
    target: 'akwaIbom',
    description,
    variables: [
      ...standardVariables,
      'candidate.gradeLevel',
      'candidate.step',
      'candidate.mda',
      'candidate.fileNumber',
      'candidate.nin'
    ],
    signatureFields: fields,
    builderBlocks: [
      ...aksHeaderBlocks(prefix, name.replace(/^AKS-HRMS /, ''), formCode),
      ...blocks
    ]
  };
}

const akwaIbomTemplates = [
  aksTemplate({
    name: 'AKS-HRMS Acceptance of Offer of Appointment',
    description: 'Form OA-01 for formally accepting an Akwa Ibom State Civil Service appointment.',
    formCode: 'FORM OA-01',
    prefix: 'aks-oa',
    blocks: [
      textBlock('aks-oa', 5, 'Reference Offer Letter No: ___________________________    Date of Offer: ________________\nFile No: {{candidate.fileNumber}} ___________________________ (Official use only)'),
      sectionBlock('aks-oa', 6, 'Acceptance Statement', 'I, {{candidate.name}} (Surname first, in block letters), hereby formally accept the offer of appointment into the Akwa Ibom State Civil Service as:\n\nDesignation: {{candidate.position}} ___________________________    Grade Level: {{candidate.gradeLevel}} ________    Step: {{candidate.step}} ________\n\nMinistry/Department/Agency (MDA): {{candidate.mda}} ___________________________________________________________\n\nEffective Date of Assumption: _______________________________________________'),
      sectionBlock('aks-oa', 7, 'Declaration', 'I accept this appointment on the terms and conditions specified in the Offer of Appointment and the Public Service Rules. I pledge to align my service with the core values of His Excellency\'s ARISE Agenda, demonstrating transparency, accountability, and absolute dedication to the Golden Era of Akwa Ibom State.'),
      spacerBlock('aks-oa', 8, 20),
      signatureBlock('aks-oa', 9, 'Signature of Appointee')
    ]
  }),
  aksTemplate({
    name: 'AKS-HRMS Form Gen. 60 Comprehensive Staff Record',
    description: 'Revised Form Gen. 60 staff record for creating the candidate digital service profile.',
    formCode: 'FORM GEN. 60',
    prefix: 'aks-gen60',
    blocks: [
      textBlock('aks-gen60', 5, 'FEDERAL/STATE PUBLIC SERVICE - FORM GEN. 60 (Revised for AKS-HRMS)\nNote: This form serves as the primary data source for your Digital Service Profile.', {
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        padding: 10
      }),
      sectionBlock('aks-gen60', 6, 'Section A: Personal Biodata', 'Title: (Mr/Mrs/Miss/Dr/Chief) _________\nFull Name: {{candidate.name}} __________________________________________________________________________________\n(Surname) (First Name) (Middle Name)\nDate of Birth (DD/MM/YYYY): __________________    Place of Birth: ___________________________\nState of Origin: __________________    LGA of Origin: ________________    Ward/Village: ______________\nNationality: Nigerian [ ] Yes  [ ] No    Gender: [ ] Male  [ ] Female\nMarital Status: [ ] Single  [ ] Married  [ ] Divorced  [ ] Widowed\nNational Identification Number (NIN): {{candidate.nin}} ____________________________________'),
      sectionBlock('aks-gen60', 7, 'Section B: Contact Information', 'Permanent Home Address: ____________________________________________________________________\nCurrent Residential Address: __________________________________________________________________\nMobile Phone Number (1): ________________________    Mobile Phone Number (2): _________________\nPersonal Email Address: _____________________________________________________________________'),
      sectionBlock('aks-gen60', 8, 'Section C: Service Details', 'Date of First Appointment: __________________    Date of Present Appointment: _________________\nConfirmation Status: [ ] Unconfirmed  [ ] Confirmed    Date of Confirmation, if applicable: ____________\nCurrent MDA: {{candidate.mda}} _______________________________________________________________________________'),
      spacerBlock('aks-gen60', 9, 18),
      signatureBlock('aks-gen60', 10, 'Signature of Appointee')
    ]
  }),
  aksTemplate({
    name: 'AKS-HRMS Certificate of Medical Fitness',
    description: 'Form MED-01 medical fitness certification for onboarding.',
    formCode: 'FORM MED-01',
    prefix: 'aks-med',
    fields: [
      ...signatureFields,
      ...internalSignatureFields('aks-med', 'medical-officer', 'Examining doctor signature')
    ],
    blocks: [
      textBlock('aks-med', 5, 'To be completed by a Chief Medical Officer at a recognized Government Hospital.'),
      sectionBlock('aks-med', 6, 'Patient Details', 'Patient Name: {{candidate.name}} _____________________________________    Age: ________    Gender: ________'),
      sectionBlock('aks-med', 7, 'Clinical Examination Summary', 'Blood Group: _________    Genotype: _________\nVisual Acuity: Right Eye ________    Left Eye ________\nHearing: ______________________________________\nChest X-Ray Result: _____________________________________________________________________\nGeneral Physical Condition: _______________________________________________________________'),
      sectionBlock('aks-med', 8, 'Medical Declaration', 'I have examined the above-named individual and certify that they are [ ] MEDICALLY FIT / [ ] MEDICALLY UNFIT for active employment in the Akwa Ibom State Civil Service.\n\nExamining Doctor\'s Name: ________________________________________________\nMedical/Dental Council Reg No: ________________________\nHospital Name: __________________________________________________________'),
      spacerBlock('aks-med', 9, 18),
      signatureBlock('aks-med', 10, 'Official Stamp and Signature')
    ]
  }),
  aksTemplate({
    name: 'AKS-HRMS Oath of Allegiance and Official Secrecy',
    description: 'Form OATH-01 oath and secrecy undertaking administered under the Official Secrets Act.',
    formCode: 'FORM OATH-01',
    prefix: 'aks-oath',
    fields: [
      ...signatureFields,
      ...internalSignatureFields('aks-oath', 'commissioner-oaths', 'Commissioner for Oaths signature')
    ],
    blocks: [
      textBlock('aks-oath', 5, '(Administered under the Official Secrets Act)', {
        align: 'center',
        color: '#64748b',
        fontWeight: '600'
      }),
      textBlock('aks-oath', 6, 'I, {{candidate.name}} _____________________________________________________________, do solemnly swear/affirm that I will be faithful and bear true allegiance to the Federal Republic of Nigeria and the Government of Akwa Ibom State. I will discharge my duties faithfully, impartially, and in accordance with the Constitution and the Public Service Rules.\n\nI further swear/affirm that I will not directly or indirectly communicate or reveal any matter to any person which shall be brought under my consideration or shall become known to me as a civil servant of the State, except as may be required for the due discharge of my duties.\n\nSo help me God.'),
      spacerBlock('aks-oath', 7, 18),
      signatureBlock('aks-oath', 8, 'Signature of Appointee'),
      sectionBlock('aks-oath', 9, 'Before Me', 'Name of Magistrate/Commissioner for Oaths: __________________________________________\nSignature and Official Seal: ________________________    Date: ________________')
    ]
  }),
  aksTemplate({
    name: 'AKS-HRMS Indemnity and Guarantor Form',
    description: 'Form GUAR-01 guarantor and indemnity form for onboarding.',
    formCode: 'FORM GUAR-01',
    prefix: 'aks-guar',
    fields: [
      ...signatureFields,
      ...internalSignatureFields('aks-guar1', 'guarantor-1', 'Guarantor 1 signature', 0.65),
      ...internalSignatureFields('aks-guar2', 'guarantor-2', 'Guarantor 2 signature', 0.84)
    ],
    blocks: [
      textBlock('aks-guar', 5, 'Guarantors must be Civil Servants not below Grade Level 12, recognized Traditional Rulers, or Clergy.', {
        backgroundColor: '#fff7ed',
        borderWidth: 1,
        borderColor: '#fed7aa',
        padding: 10
      }),
      sectionBlock('aks-guar', 6, 'Guarantor 1', 'I, ____________________________________________________, of ________________________________________ (Address), voluntarily stand as a guarantor for {{candidate.name}} ___________________________________ (Appointee). I hold myself jointly and severally liable for any financial loss, damages, or misconduct perpetrated by the appointee in the course of their service.\n\nOccupation/Rank: ________________________    Organization/MDA: _______________________________\nPhone Number: ________________________    NIN: _______________________________________\nSignature: ________________________    Date: ________________'),
      sectionBlock('aks-guar', 7, 'Guarantor 2', 'I, ____________________________________________________, of ________________________________________ (Address), voluntarily stand as a guarantor for {{candidate.name}} ___________________________________ (Appointee). I hold myself jointly and severally liable for any financial loss, damages, or misconduct perpetrated by the appointee in the course of their service.\n\nOccupation/Rank: ________________________    Organization/MDA: _______________________________\nPhone Number: ________________________    NIN: _______________________________________\nSignature: ________________________    Date: ________________')
    ]
  }),
  aksTemplate({
    name: 'AKS-HRMS Payroll, Tax, and Pension Mandate',
    description: 'Form BANK-01 salary account, tax, and pension mandate.',
    formCode: 'FORM BANK-01',
    prefix: 'aks-bank',
    blocks: [
      sectionBlock('aks-bank', 5, 'Part A: Salary Account Details', 'Bank Name: ________________________________________________\nAccount Number (NUBAN): __________________________________\nAccount Name: _____________________________________________\nBank Verification Number (BVN): _____________________________'),
      sectionBlock('aks-bank', 6, 'Part B: Statutory Deductions', 'Tax Identification Number (TIN): ______________________________\nPension Fund Administrator (PFA): ___________________________\nRetirement Savings Account (RSA) PIN: _______________________'),
      textBlock('aks-bank', 7, 'I authorize the Office of the Accountant General to remit my monthly salary to the stated bank account and effect all statutory pension and tax deductions.'),
      spacerBlock('aks-bank', 8, 18),
      signatureBlock('aks-bank', 9, 'Signature')
    ]
  }),
  aksTemplate({
    name: 'AKS-HRMS Next of Kin and Emergency Contact Declaration',
    description: 'Form NOK-01 next of kin and emergency contact declaration.',
    formCode: 'FORM NOK-01',
    prefix: 'aks-nok',
    blocks: [
      textBlock('aks-nok', 5, 'Please clearly state the percentage of benefit allocation if specifying more than one Next of Kin.'),
      tableBlock('aks-nok', 6, [
        ['Name of Next of Kin', 'Relationship', 'Phone Number', 'Residential Address', '% of Benefits'],
        ['________________________', '______________', '_______________', '____________________________________', '_______%'],
        ['________________________', '______________', '_______________', '____________________________________', '_______%']
      ]),
      sectionBlock('aks-nok', 7, 'Emergency Contact Person', 'To be contacted strictly for medical or workplace emergencies.\n\nName: _____________________________________    Relationship: ________________________\nPhone Number: ____________________________    Alternate Phone: ______________________'),
      spacerBlock('aks-nok', 8, 18),
      signatureBlock('aks-nok', 9, 'Signature of Appointee')
    ]
  }),
  aksTemplate({
    name: 'AKS-HRMS Educational and Professional Qualifications',
    description: 'Form QUAL-01 declaration of educational, NYSC, and professional qualifications.',
    formCode: 'FORM QUAL-01',
    prefix: 'aks-qual',
    blocks: [
      textBlock('aks-qual', 5, 'Warning: Presentation of forged or altered certificates will lead to immediate dismissal and criminal prosecution.', {
        backgroundColor: '#fef2f2',
        borderWidth: 1,
        borderColor: '#fecaca',
        padding: 10,
        fontWeight: '600',
        color: '#991b1b'
      }),
      sectionBlock('aks-qual', 6, 'A. Academic Qualifications', ''),
      tableBlock('aks-qual', 7, [
        ['Level', 'Name of Institution', 'Qualification Obtained', 'Year', 'Certificate No.'],
        ['Tertiary', '___________________________', '________________________', '_______', '________________'],
        ['Secondary', '___________________________', '________________________', '_______', '________________'],
        ['Primary', '___________________________', '________________________', '_______', '________________']
      ]),
      sectionBlock('aks-qual', 8, 'B. NYSC Certification', 'NYSC Status: [ ] Discharged  [ ] Exempted  [ ] Excluded\nNYSC Certificate Number: ________________________    Year of Completion: _______________'),
      sectionBlock('aks-qual', 9, 'C. Professional Bodies', 'Professional Body: ________________________    Membership/Registration No: ________________'),
      spacerBlock('aks-qual', 10, 18),
      signatureBlock('aks-qual', 11, 'Signature of Appointee')
    ]
  }),
  aksTemplate({
    name: 'AKS-HRMS Certificate of Assumption of Duty',
    description: 'Form AOD-01 assumption of duty certificate completed by the Director of Administration.',
    formCode: 'FORM AOD-01',
    prefix: 'aks-aod',
    fields: [
      ...signatureFields,
      ...internalSignatureFields('aks-aod', 'director-admin', 'Director of Admin signature')
    ],
    blocks: [
      textBlock('aks-aod', 5, 'To be completed by the Director of Administration upon the officer\'s physical resumption.'),
      textBlock('aks-aod', 6, 'This is to certify that Mr/Mrs/Miss {{candidate.name}} ___________________________________________________________\n\nhas officially assumed duty today, the ________ day of ____________, 20____,\n\nin the capacity of {{candidate.position}} ________________________________________ (Designation) on Grade Level {{candidate.gradeLevel}} ________\n\nat the {{candidate.mda}} __________________________________________________________________________ (MDA).'),
      spacerBlock('aks-aod', 7, 18),
      signatureBlock('aks-aod', 8, 'Appointee Signature'),
      sectionBlock('aks-aod', 9, 'Verified By', 'Name of Permanent Secretary / Director of Admin: ___________________________________________\nSignature and Official Stamp: ________________________    Date: ________________')
    ]
  }),
  aksTemplate({
    name: 'AKS-HRMS Digital Access and Final Undertaking',
    description: 'Form UND-01 AKS-HRMS digital access and final undertaking.',
    formCode: 'FORM UND-01',
    prefix: 'aks-und',
    fields: [
      ...signatureFields,
      ...internalSignatureFields('aks-und', 'admin-officer', 'Admin officer sign-off')
    ],
    blocks: [
      sectionBlock('aks-und', 5, 'IT Security and Policy Acknowledgment', 'I acknowledge that upon the completion of this onboarding, I will be issued digital access credentials to the Akwa Ibom State Human Resource Management System (AKS-HRMS).'),
      sectionBlock('aks-und', 6, 'I Undertake To', '1. Maintain the absolute confidentiality of my AKS-HRMS login credentials.\n2. Ensure all data I submit or update on the portal remains accurate and truthful.\n3. Abide by the State Government\'s IT Security Policy regarding the use of official digital infrastructure.'),
      textBlock('aks-und', 7, 'I confirm that I have completed the physical documentation process and submitted all required authentic credentials. I accept full responsibility as a civil servant of Akwa Ibom State.'),
      spacerBlock('aks-und', 8, 18),
      signatureBlock('aks-und', 9, 'Signature of Appointee'),
      textBlock('aks-und', 10, 'AKS-HRMS Digital ID Generated (Yes/No): ________    Admin Officer Sign-off: ________________')
    ]
  })
];

function builderBlocks(template) {
  if (Array.isArray(template.builderBlocks) && template.builderBlocks.length) {
    return template.builderBlocks;
  }

  return [
    { id: `${template.category}-heading`, type: 'heading', content: { text: template.name } },
    { id: `${template.category}-body`, type: 'text', content: { text: template.text } },
    { id: `${template.category}-signature`, type: 'signature', content: { label: 'Signature' } }
  ];
}

function isAkwaIbomOrganization(organization) {
  if (seedAkwaIbomForAll) return true;

  const haystack = [
    organization.name,
    organization.description,
    organization.website,
    organization.idpOrganizationId
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes('akwaibom') ||
    haystack.includes('akwa ibom') ||
    /\b(akwa|ibom|aks|jetstone)\b/.test(haystack);
}

function shouldSeedTemplate(organization, template) {
  if (template.target === 'akwaIbom') {
    return isAkwaIbomOrganization(organization);
  }
  return true;
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(mongoUri);
  const organizations = await Organization.find({ isActive: { $ne: false } }).select('_id name description website idpOrganizationId');
  const templates = seedOnlyAkwaIbom ? akwaIbomTemplates : [...defaultTemplates, ...akwaIbomTemplates];
  let created = 0;
  let skipped = 0;
  let ineligible = 0;

  for (const organization of organizations) {
    for (const template of templates) {
      if (!shouldSeedTemplate(organization, template)) {
        ineligible += 1;
        continue;
      }

      const exists = await OnboardingDocumentTemplate.exists({
        organization: organization._id,
        name: template.name
      });

      if (exists) {
        skipped += 1;
        continue;
      }

      if (dryRun) {
        console.log(`[dry-run] would create "${template.name}" for ${organization.name}`);
        created += 1;
        continue;
      }

      await OnboardingDocumentTemplate.create({
        organization: organization._id,
        name: template.name,
        description: template.description,
        category: template.category,
        isDefault: true,
        isSystem: true,
        builderBlocks: builderBlocks(template),
        variables: template.variables || standardVariables,
        signatureFields: template.signatureFields || signatureFields
      });
      created += 1;
      console.log(`Created "${template.name}" for ${organization.name}`);
    }
  }

  console.log(JSON.stringify({
    dryRun,
    seedOnlyAkwaIbom,
    organizations: organizations.length,
    templates: templates.length,
    akwaIbomTemplates: akwaIbomTemplates.length,
    created,
    skipped,
    ineligible
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
