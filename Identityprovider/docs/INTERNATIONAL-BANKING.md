# International Banking Integration - Research Summary

## Banking Information Usage in Payroll

**YES** - Banking information collected in the IDP **IS USED** by the Payroll module for:
1. **Direct Deposit Processing** - Automated salary payments to employee bank accounts
2. **Bank Transfer Files** - Generating payment files (ACH, BACS, SEPA, etc.)
3. **Payment Routing** - Ensuring payments reach the correct bank and account
4. **Compliance** - Meeting regulatory requirements for payroll processing

**Data Flow:**
```
Employee Updates Banking → IDP Stores (Encrypted) → Webhook to Payroll → Payroll Uses for Payment Processing
```

---

## Banking Requirements by Country/Region

### 🇺🇸 United States (USA)
**Payment System**: ACH (Automated Clearing House)

**Required Fields:**
- **Routing Number (ABA RTN)**: 9-digit code identifying the bank
- **Account Number**: Unique account identifier
- **Account Type**: Checking or Savings

**Format:**
- Routing: `123456789` (exactly 9 digits)
- Account: Variable length (typically 8-17 digits)

**Note**: USA does NOT use IBAN

---

### 🇬🇧 United Kingdom (UK)
**Payment System**: BACS (Bankers' Automated Clearing Services) / Faster Payments

**Required Fields:**
- **Sort Code**: 6-digit code (identifies bank and branch)
- **Account Number**: 8-digit account number
- **IBAN**: Optional but recommended for international (GB + 2 check digits + sort code + account)
- **BIC/SWIFT**: Optional for international transfers

**Format:**
- Sort Code: `12-34-56` (3 pairs of digits)
- Account: `12345678` (8 digits)
- IBAN: `GB29 NWBK 6016 1331 9268 19`

---

### 🇪🇺 European Union (Europe)
**Payment System**: SEPA (Single Euro Payments Area)

**Required Fields:**
- **IBAN**: Up to 34 alphanumeric characters (includes country code, check digits, bank code, account)
- **BIC/SWIFT**: 8 or 11 character code (identifies bank globally)

**Format:**
- IBAN: `DE89370400440532013000` (country code + check + bank + account)
- BIC: `DEUTDEFF` (8 chars) or `DEUTDEFFXXX` (11 chars)

**Countries Using IBAN**: All EU countries, plus Norway, Switzerland, Iceland, etc.

---

### 🇳🇬 Nigeria
**Payment System**: NIBSS (Nigeria Inter-Bank Settlement System)

**Required Fields:**
- **Bank Name**: Full name of the bank
- **Bank Code**: 3-digit code identifying the bank
- **Account Number**: 10-digit account number
- **Account Name**: Account holder name (for verification)

**Format:**
- Bank Code: `058` (GTBank), `011` (First Bank), etc.
- Account: `0123456789` (10 digits)

**Note**: Nigeria does NOT use IBAN. International transfers require SWIFT/BIC code of the bank.

---

## Common Nigerian Bank Codes

| Bank Name | Code |
|-----------|------|
| Access Bank | 044 |
| Citibank | 023 |
| Ecobank | 050 |
| Fidelity Bank | 070 |
| First Bank of Nigeria | 011 |
| GT Bank (Guaranty Trust) | 058 |
| Heritage Bank | 030 |
| Keystone Bank | 082 |
| Polaris Bank | 076 |
| Providus Bank | 101 |
| Stanbic IBTC Bank | 221 |
| Standard Chartered | 068 |
| Sterling Bank | 232 |
| Union Bank | 032 |
| United Bank for Africa (UBA) | 033 |
| Unity Bank | 215 |
| Wema Bank | 035 |
| Zenith Bank | 057 |

---

## Validation Requirements

### USA
- Routing number MUST be exactly 9 digits
- Account number validation varies by bank
- No check digit validation for routing numbers

### UK
- Sort code MUST be exactly 6 digits
- Account number MUST be exactly 8 digits
- IBAN uses MOD-97-10 algorithm for check digit validation

### Europe
- IBAN length varies by country (15-34 characters)
- IBAN check digits validated using MOD-97-10
- BIC must be 8 or 11 characters

### Nigeria
- Account number MUST be exactly 10 digits
- Bank code MUST be exactly 3 digits
- No standard check digit validation

---

## Implementation Strategy

### 1. Country Selection
Add country selector that shows/hides relevant fields dynamically

### 2. Dynamic Form Fields
```javascript
if (country === 'USA') {
  show: routing number, account number, account type
}
if (country === 'UK') {
  show: sort code, account number, optional IBAN
}
if (country === 'EU') {
  show: IBAN, BIC/SWIFT
}
if (country === 'Nigeria') {
  show: bank name dropdown, bank code (auto-filled), account number
}
```

### 3. Database Schema
```javascript
banking: {
  country: String,  // 'USA', 'UK', 'EU', 'Nigeria'
  accounts: [{
    // USA fields
    routingNumber: String,
    accountNumber: String,
    accountType: String,  // 'checking', 'savings'
    
    // UK fields
    sortCode: String,
    
    // EU fields
    iban: String,
    bicSwift: String,
    
    // Nigeria fields
    bankName: String,
    bankCode: String,
    
    // Common fields
    bankName: String,
    accountHolderName: String,
    percentage: Number,
    isActive: Boolean
  }]
}
```

### 4. Validation
- Client-side: Format validation (length, pattern)
- Server-side: Additional validation before storing
- Encryption: All sensitive data (account numbers, routing numbers, IBAN) encrypted at rest

---

## Payroll Integration Webhook

When banking info is updated, send to Payroll module:

```javascript
POST /api/webhooks/employee-banking-updated
{
  event: 'employee.banking_info_updated',
  employeeId: '...',
  organizationId: '...',
  country: 'USA',
  banking: {
    // Country-specific fields (encrypted)
  },
  signedAuthorizationUrl: 'https://...' // PDF of signed direct deposit form
}
```

---

## Security Considerations

1. **Encryption**: All banking data MUST be encrypted at rest
2. **Access Logs**: Log all access to banking information
3. **PCI Compliance**: Follow PCI-DSS if storing card data
4. **Data Retention**: Follow local regulations (GDPR, etc.)
5. **Transmission**: Always use HTTPS/TLS for data transmission

---

**Sources**: Research compiled from SWIFT, IBAN Registry, banking regulations, and payment system documentation.
