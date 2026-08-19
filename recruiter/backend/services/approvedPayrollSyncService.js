const OnboardingFormSubmission = require('../models/OnboardingFormSubmission');
const { serializeSubmission } = require('./onboardingSecurityService');

function valueMap(submission) {
  return new Map((submission?.values || []).map((entry) => [
    entry.key,
    entry.sensitive ? entry.revealedValue : entry.value,
  ]));
}

function text(value) {
  return String(value ?? '').trim();
}

function addressValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      street: text(value.street || value.addressLine1 || value.line1),
      street2: text(value.street2 || value.addressLine2 || value.line2),
      city: text(value.city || value.town),
      state: text(value.state || value.county || value.region),
      zipCode: text(value.zipCode || value.postalCode || value.postcode),
      country: text(value.country),
    };
  }
  return {
    street: text(value),
    street2: '',
    city: '',
    state: '',
    zipCode: '',
    country: '',
  };
}

function bankAccount(values) {
  const country = text(values.get('bankCountry')) || 'Other';
  const identifier = text(values.get('bankIdentifier'));
  const accountNumber = text(values.get('bankAccountNumber'));
  const account = {
    country,
    bankName: text(values.get('bankName')),
    accountHolderName: text(values.get('bankAccountName')),
    accountNumber,
    accountType: ['UK', 'Nigeria'].includes(country) ? 'current' : 'checking',
    percentage: 100,
    isActive: true,
    isPrimary: true,
  };
  if (country === 'USA') account.routingNumber = identifier;
  else if (country === 'UK') account.sortCode = identifier;
  else if (country === 'Nigeria') account.bankCode = identifier;
  else if (country === 'EU') {
    account.iban = accountNumber;
    account.bicSwift = identifier;
  } else {
    account.routingNumber = identifier;
  }
  return account;
}

function mapApprovedPayrollSync(transition, submission) {
  const revealed = serializeSubmission(submission, { reveal: true });
  const values = valueMap(revealed);
  const declaredDependentsCount = Math.max(0, Number(values.get('dependentsCount') || 0));
  const declaredStatus = text(values.get('dependentsStatus')).toLowerCase();

  return {
    source: 'recruiter_people_transition',
    approvedAt: submission.reviewedAt || submission.updatedAt,
    submissionId: submission._id.toString(),
    name: text(values.get('legalName')) || transition.subject?.name || transition.candidate?.email,
    personalInfo: {
      dateOfBirth: values.get('dateOfBirth') || null,
      mailingAddress: addressValue(values.get('address')),
      phoneNumbers: {
        mobile: text(values.get('phone')),
        home: '',
        work: '',
      },
      emergencyContact: {
        name: text(values.get('emergencyContactName')),
        relationship: text(values.get('emergencyContactRelationship')),
        phone: text(values.get('emergencyContactPhone')),
        email: text(values.get('emergencyContactEmail')),
      },
    },
    taxInfo: {
      taxId: text(values.get('taxId')),
      lastUpdated: new Date(),
    },
    banking: {
      country: text(values.get('bankCountry')) || 'Other',
      accounts: [bankAccount(values)],
    },
    dependentsDeclaration: {
      status: declaredStatus === 'none' || declaredDependentsCount === 0 ? 'none' : 'provided',
      count: declaredDependentsCount,
      confirmedAt: new Date(),
      lastUpdated: new Date(),
    },
  };
}

async function buildApprovedPayrollSync(transition) {
  const submission = await OnboardingFormSubmission.findOne({
    onboarding: transition._id,
    status: 'approved',
  }).sort({ reviewedAt: -1, updatedAt: -1 });
  if (!submission) {
    const error = new Error('Approved onboarding payroll details are required before provisioning');
    error.statusCode = 409;
    throw error;
  }
  return mapApprovedPayrollSync(transition, submission);
}

module.exports = { buildApprovedPayrollSync, mapApprovedPayrollSync };
