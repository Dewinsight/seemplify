const mongoose = require('mongoose');
const PayrollProfile = mongoose.model('PayrollProfile');
const Payslip = mongoose.model('Payslip');

class TaxCalculationService {
  constructor() {
    // Progressive tax brackets (example - can be configurable)
    this.taxBrackets = {
      'USD': [
        { min: 0, max: 11000, rate: 0.10 },
        { min: 11001, max: 44725, rate: 0.12 },
        { min: 44726, max: 95375, rate: 0.22 },
        { min: 95376, max: 182050, rate: 0.24 },
        { min: 182051, max: 231250, rate: 0.32 },
        { min: 231251, max: 578125, rate: 0.35 },
        { min: 578126, max: Infinity, rate: 0.37 }
      ]
    };
  }

  calculateTax(annualIncome, currency = 'USD', regime = 'standard') {
    if (regime === 'simplified') {
      return Math.round(annualIncome * 0.15); // Simplified flat rate
    }

    const brackets = this.taxBrackets[currency] || this.taxBrackets['USD'];
    let tax = 0;

    for (const bracket of brackets) {
      if (annualIncome > bracket.min) {
        const taxableInBracket = Math.min(annualIncome, bracket.max) - bracket.min + 1;
        tax += taxableInBracket * bracket.rate;
      }
    }

    return Math.round(tax);
  }

  calculateMonthlyTax(monthlyGross, currency = 'USD', regime = 'standard') {
    const annualIncome = monthlyGross * 12;
    const annualTax = this.calculateTax(annualIncome, currency, regime);
    return Math.round(annualTax / 12);
  }

  calculateSocialSecurity(grossIncome, currency = 'USD') {
    // Example: Social Security at 6.2% up to wage base limit
    const ssRates = {
      'USD': { rate: 0.062, maxWageBase: 160200 }
    };

    const rate = ssRates[currency]?.rate || 0.062;
    const maxWageBase = ssRates[currency]?.maxWageBase || Infinity;
    
    const annualWage = grossIncome * 12;
    const taxableWage = Math.min(annualWage, maxWageBase);
    
    return Math.round((taxableWage * rate) / 12);
  }
}

module.exports = TaxCalculationService;