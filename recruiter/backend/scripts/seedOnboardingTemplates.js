const mongoose = require('mongoose');
require('dotenv').config();

const Organization = require('../models/Organization');
const OnboardingDocumentTemplate = require('../models/OnboardingDocumentTemplate');

const dryRun = process.argv.includes('--dry-run');

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

const signatureFields = [
  {
    id: 'candidate-signature',
    role: 'candidate',
    type: 'signature',
    label: 'Candidate signature',
    page: 1,
    x: 0.12,
    y: 0.78,
    width: 0.32,
    height: 0.08,
    required: true
  },
  {
    id: 'candidate-date',
    role: 'candidate',
    type: 'date',
    label: 'Date signed',
    page: 1,
    x: 0.52,
    y: 0.78,
    width: 0.22,
    height: 0.05,
    required: true
  }
];

function builderBlocks(template) {
  return [
    { id: `${template.category}-heading`, type: 'heading', content: { text: template.name } },
    { id: `${template.category}-body`, type: 'text', content: { text: template.text } },
    { id: `${template.category}-signature`, type: 'signature', content: { label: 'Candidate signature' } }
  ];
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(mongoUri);
  const organizations = await Organization.find({ isActive: { $ne: false } }).select('_id name');
  let created = 0;
  let skipped = 0;

  for (const organization of organizations) {
    for (const template of defaultTemplates) {
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
        variables: ['candidate.name', 'candidate.firstName', 'candidate.position', 'organization.name', 'today'],
        signatureFields
      });
      created += 1;
      console.log(`Created "${template.name}" for ${organization.name}`);
    }
  }

  console.log(JSON.stringify({ dryRun, organizations: organizations.length, created, skipped }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
