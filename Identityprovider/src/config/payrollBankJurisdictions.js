const CURRENT_AND_SAVINGS_ACCOUNT_TYPES = [
  { value: 'current', label: 'Current Account' },
  { value: 'savings', label: 'Savings Account' },
]

export const NIGERIAN_BANK_OPTIONS = [
  { code: '044', name: 'Access Bank' },
  { code: '023', name: 'Citibank' },
  { code: '050', name: 'Ecobank' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '011', name: 'First Bank of Nigeria' },
  { code: '058', name: 'GT Bank' },
  { code: '030', name: 'Heritage Bank' },
  { code: '082', name: 'Keystone Bank' },
  { code: '076', name: 'Polaris Bank' },
  { code: '101', name: 'Providus Bank' },
  { code: '221', name: 'Stanbic IBTC Bank' },
  { code: '068', name: 'Standard Chartered' },
  { code: '232', name: 'Sterling Bank' },
  { code: '032', name: 'Union Bank' },
  { code: '033', name: 'United Bank for Africa - UBA' },
  { code: '215', name: 'Unity Bank' },
  { code: '035', name: 'Wema Bank' },
  { code: '057', name: 'Zenith Bank' },
]

export const PAYROLL_BANK_JURISDICTIONS = [
  {
    value: 'USA',
    code: 'US',
    label: 'United States',
    description: 'Use your account number and 9-digit ABA routing number for local payroll deposits.',
    accountNumberLabel: 'Account Number',
    accountNumberPlaceholder: 'Bank account number',
    accountNumberHint: 'Your U.S. bank account number, typically 8 to 17 digits.',
    requiresAccountNumber: true,
    localField: {
      key: 'routingNumber',
      label: 'Routing Number (ABA)',
      placeholder: '9 digits',
      hint: 'Use the 9-digit ABA routing transit number for ACH or direct deposit.',
      required: true,
    },
    supportsIban: false,
    requiresIban: false,
    supportsSwift: true,
    swiftRequired: false,
    swiftHint: 'Add a SWIFT/BIC code if this account should also receive international wire transfers.',
    bankDirectory: null,
    accountTypes: [
      { value: 'checking', label: 'Checking' },
      { value: 'savings', label: 'Savings' },
    ],
  },
  {
    value: 'UK',
    code: 'GB',
    label: 'United Kingdom',
    description: 'Use your sort code and 8-digit account number for local UK payments.',
    accountNumberLabel: 'Account Number',
    accountNumberPlaceholder: '8-digit account number',
    accountNumberHint: 'Use your 8-digit UK account number.',
    requiresAccountNumber: true,
    localField: {
      key: 'sortCode',
      label: 'Sort Code',
      placeholder: '12-34-56',
      hint: 'Use the 6-digit sort code for the bank and branch in XX-XX-XX format.',
      required: true,
    },
    supportsIban: true,
    requiresIban: false,
    ibanHint: 'Optional, but useful when payroll or finance needs to send cross-border payments.',
    supportsSwift: true,
    swiftRequired: false,
    swiftHint: 'Add the bank SWIFT/BIC code for international transfers.',
    bankDirectory: null,
    accountTypes: CURRENT_AND_SAVINGS_ACCOUNT_TYPES,
  },
  {
    value: 'EU',
    code: 'EU',
    label: 'European Union member state',
    description: 'Use IBAN for SEPA payments. Add SWIFT/BIC when the bank asks for it for cross-border transfers.',
    accountNumberLabel: 'Account Number',
    accountNumberPlaceholder: 'Bank account number',
    accountNumberHint: '',
    requiresAccountNumber: false,
    localField: null,
    supportsIban: true,
    requiresIban: true,
    ibanHint: 'IBAN is required for SEPA and other EU payroll payments.',
    supportsSwift: true,
    swiftRequired: false,
    swiftHint: 'BIC/SWIFT is optional for many SEPA payments, but include it if your bank uses it for international transfers.',
    bankDirectory: null,
    accountTypes: CURRENT_AND_SAVINGS_ACCOUNT_TYPES,
  },
  {
    value: 'Nigeria',
    code: 'NG',
    label: 'Nigeria',
    description: 'Use your 10-digit NUBAN account number and 3-digit bank code for local payouts.',
    accountNumberLabel: 'Account Number',
    accountNumberPlaceholder: '10-digit NUBAN account number',
    accountNumberHint: 'Use your 10-digit Nigerian NUBAN account number.',
    requiresAccountNumber: true,
    localField: {
      key: 'bankCode',
      label: 'Bank Code',
      placeholder: '3-digit bank code',
      hint: 'Use the 3-digit institution code for your bank.',
      required: true,
    },
    supportsIban: false,
    requiresIban: false,
    supportsSwift: true,
    swiftRequired: false,
    swiftHint: 'Add the bank SWIFT/BIC code if this account should receive international transfers.',
    bankDirectory: 'nigeria',
    accountTypes: [
      { value: 'salary', label: 'Salary Account' },
      { value: 'savings', label: 'Savings Account' },
      { value: 'current', label: 'Current Account' },
    ],
  },
  {
    value: 'Ghana',
    code: 'GH',
    label: 'Ghana',
    description: 'Use your account number plus the local bank or branch code used for domestic transfers.',
    accountNumberLabel: 'Account Number',
    accountNumberPlaceholder: 'Bank account number',
    accountNumberHint: 'Use the account number issued by your Ghanaian bank.',
    requiresAccountNumber: true,
    localField: {
      key: 'bankCode',
      label: 'Bank / Branch Code',
      placeholder: 'Local bank or branch code',
      hint: 'Use the local code your bank provides for domestic transfers.',
      required: true,
    },
    supportsIban: false,
    requiresIban: false,
    supportsSwift: true,
    swiftRequired: false,
    swiftHint: 'Add the bank SWIFT/BIC code for international transfers into Ghana.',
    bankDirectory: null,
    accountTypes: CURRENT_AND_SAVINGS_ACCOUNT_TYPES,
  },
  {
    value: 'Kenya',
    code: 'KE',
    label: 'Kenya',
    description: 'Use your account number and the bank or branch code used for local EFT or RTGS payments.',
    accountNumberLabel: 'Account Number',
    accountNumberPlaceholder: 'Bank account number',
    accountNumberHint: 'Use the account number issued by your Kenyan bank.',
    requiresAccountNumber: true,
    localField: {
      key: 'bankCode',
      label: 'Bank / Branch Code',
      placeholder: 'Bank or branch code',
      hint: 'Use the local bank or branch code your bank provides for EFT or RTGS.',
      required: true,
    },
    supportsIban: false,
    requiresIban: false,
    supportsSwift: true,
    swiftRequired: false,
    swiftHint: 'Add the bank SWIFT/BIC code for international transfers into Kenya.',
    bankDirectory: null,
    accountTypes: CURRENT_AND_SAVINGS_ACCOUNT_TYPES,
  },
  {
    value: 'South Africa',
    code: 'ZA',
    label: 'South Africa',
    description: 'Use your account number and branch or universal branch code for local EFT payments.',
    accountNumberLabel: 'Account Number',
    accountNumberPlaceholder: 'Bank account number',
    accountNumberHint: 'Use the account number issued by your South African bank.',
    requiresAccountNumber: true,
    localField: {
      key: 'bankCode',
      label: 'Branch Code',
      placeholder: '6-digit branch code',
      hint: 'Use the branch or universal branch code used for local EFT payments.',
      required: true,
    },
    supportsIban: false,
    requiresIban: false,
    supportsSwift: true,
    swiftRequired: false,
    swiftHint: 'Add the bank SWIFT/BIC code for international transfers into South Africa.',
    bankDirectory: null,
    accountTypes: CURRENT_AND_SAVINGS_ACCOUNT_TYPES,
  },
  {
    value: 'Other',
    code: 'OTHER',
    label: 'Other / custom country',
    description: 'Use the local account details your bank requires. Add SWIFT/BIC and IBAN when needed for international transfers.',
    accountNumberLabel: 'Account Number',
    accountNumberPlaceholder: 'Bank account number',
    accountNumberHint: 'Use the domestic account number your bank expects for local payments.',
    requiresAccountNumber: true,
    localField: null,
    supportsIban: true,
    requiresIban: false,
    ibanHint: 'If your bank uses IBAN, add it here.',
    supportsSwift: true,
    swiftRequired: false,
    swiftHint: 'Add the bank SWIFT/BIC code if finance will send international transfers.',
    bankDirectory: null,
    accountTypes: [
      { value: 'checking', label: 'Checking' },
      { value: 'current', label: 'Current Account' },
      { value: 'savings', label: 'Savings Account' },
    ],
  },
]

export function normalizePayrollBankCountry(value = 'USA') {
  const normalized = String(value || '').trim().toLowerCase()
  const match = PAYROLL_BANK_JURISDICTIONS.find((item) => item.value.toLowerCase() === normalized)
  return match ? match.value : 'Other'
}

export function getPayrollBankJurisdiction(value = 'USA') {
  const normalized = normalizePayrollBankCountry(value)
  return PAYROLL_BANK_JURISDICTIONS.find((item) => item.value === normalized) || PAYROLL_BANK_JURISDICTIONS[0]
}

export function getPayrollBankAccountTypes(value = 'USA') {
  return [...getPayrollBankJurisdiction(value).accountTypes]
}

export function getPayrollDefaultBankAccountType(value = 'USA', options = {}) {
  const preferSalary = options.preferSalary !== false
  const types = getPayrollBankAccountTypes(value)

  if (!preferSalary) {
    const nonSalary = types.find((item) => item.value !== 'salary')
    if (nonSalary) {
      return nonSalary.value
    }
  }

  return types[0]?.value || 'current'
}

export function getPayrollBankLocalField(value = 'USA') {
  return getPayrollBankJurisdiction(value).localField || null
}
