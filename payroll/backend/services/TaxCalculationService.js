/**
 * Tax Calculation Service
 * 
 * Handles all tax-related calculations for payroll processing.
 * Supports flat-rate and progressive tax bracket systems.
 */

class TaxCalculationService {
  constructor() {
    // Default configuration
    this.defaults = {
      flatTaxRate: 10, // 10% flat rate
      socialSecurityRate: 5, // 5%
      socialSecurityCap: 160200 * 12, // Annual cap (e.g., US 2023)
      taxRegime: 'flat' // 'flat', 'progressive_uk', 'progressive_us', 'progressive_generic'
    };

    // UK Tax Brackets (2023/24) - Monthly
    this.ukBrackets = [
      { min: 0, max: 1047, rate: 0 },         // Personal Allowance (£12570/12)
      { min: 1047, max: 4379, rate: 20 },     // Basic rate
      { min: 4379, max: 12500, rate: 40 },    // Higher rate
      { min: 12500, max: Infinity, rate: 45 } // Additional rate
    ];

    // US Federal Tax Brackets (2023) - Monthly (Single Filer)
    this.usBrackets = [
      { min: 0, max: 916, rate: 10 },
      { min: 916, max: 3738, rate: 12 },
      { min: 3738, max: 7846, rate: 22 },
      { min: 7846, max: 14221, rate: 24 },
      { min: 14221, max: 17879, rate: 32 },
      { min: 17879, max: 44929, rate: 35 },
      { min: 44929, max: Infinity, rate: 37 }
    ];

    // Generic Progressive Brackets
    this.genericBrackets = [
      { min: 0, max: 1000, rate: 0 },
      { min: 1000, max: 3000, rate: 10 },
      { min: 3000, max: 7000, rate: 20 },
      { min: 7000, max: 15000, rate: 30 },
      { min: 15000, max: Infinity, rate: 40 }
    ];
  }

  /**
   * Calculate Income Tax
   * @param {number} grossPay - The gross taxable income
   * @param {Object} config - Tax configuration
   * @returns {Object} Tax breakdown
   */
  calculateIncomeTax(grossPay, config = {}) {
    const regime = config.taxRegime || this.defaults.taxRegime;

    if (regime === 'flat') {
      return this._calculateFlatTax(grossPay, config);
    } else {
      return this._calculateProgressiveTax(grossPay, regime, config);
    }
  }

  /**
   * Flat Tax Calculation
   */
  _calculateFlatTax(grossPay, config) {
    const taxRate = config.taxRate || this.defaults.flatTaxRate;
    const taxAmount = (grossPay * taxRate) / 100;

    return {
      grossTaxableIncome: grossPay,
      netTaxableIncome: grossPay,
      taxRate: taxRate,
      taxAmount: parseFloat(taxAmount.toFixed(2)),
      method: 'flat'
    };
  }

  /**
   * Progressive Tax Calculation
   * Uses tax brackets where each portion of income is taxed at its bracket rate
   */
  _calculateProgressiveTax(grossPay, regime, config) {
    let brackets;

    switch (regime) {
      case 'progressive_uk':
        brackets = this.ukBrackets;
        break;
      case 'progressive_us':
        brackets = this.usBrackets;
        break;
      case 'progressive_generic':
      default:
        brackets = config.customBrackets || this.genericBrackets;
    }

    let totalTax = 0;
    let remainingIncome = grossPay;
    const bracketBreakdown = [];

    for (const bracket of brackets) {
      if (remainingIncome <= 0) break;

      const taxableInBracket = Math.min(
        Math.max(0, grossPay - bracket.min),
        bracket.max - bracket.min
      );

      if (taxableInBracket > 0 && grossPay > bracket.min) {
        const actualTaxable = Math.min(taxableInBracket, remainingIncome);
        const taxInBracket = (actualTaxable * bracket.rate) / 100;
        totalTax += taxInBracket;

        bracketBreakdown.push({
          bracket: `${bracket.min} - ${bracket.max === Infinity ? '∞' : bracket.max}`,
          rate: bracket.rate,
          taxable: parseFloat(actualTaxable.toFixed(2)),
          tax: parseFloat(taxInBracket.toFixed(2))
        });

        remainingIncome -= actualTaxable;
      }
    }

    const effectiveRate = grossPay > 0 ? (totalTax / grossPay) * 100 : 0;

    return {
      grossTaxableIncome: grossPay,
      netTaxableIncome: grossPay - totalTax,
      taxRate: parseFloat(effectiveRate.toFixed(2)),
      taxAmount: parseFloat(totalTax.toFixed(2)),
      method: 'progressive',
      regime: regime,
      bracketBreakdown
    };
  }

  /**
   * Calculate Social Security Contribution
   * @param {number} grossPay - The gross pay subject to SS
   * @param {Object} config - SS configuration (optional)
   * @returns {Object} SS breakdown
   */
  calculateSocialSecurity(grossPay, config = {}) {
    const rate = config.socialSecurityRate || this.defaults.socialSecurityRate;
    const cap = config.socialSecurityCap || this.defaults.socialSecurityCap;
    const ytdEarnings = config.ytdEarnings || 0;

    // Apply cap (only tax earnings up to cap)
    let taxableAmount = grossPay;
    let hitCap = false;

    if (ytdEarnings >= cap) {
      // Already exceeded cap this year
      taxableAmount = 0;
      hitCap = true;
    } else if (ytdEarnings + grossPay > cap) {
      // Partially exceeds cap
      taxableAmount = cap - ytdEarnings;
      hitCap = true;
    }

    const amount = (taxableAmount * rate) / 100;

    return {
      rate: rate,
      taxableAmount: parseFloat(taxableAmount.toFixed(2)),
      amount: parseFloat(amount.toFixed(2)),
      hitCap,
      cap
    };
  }

  /**
   * Get available tax regimes
   */
  getAvailableRegimes() {
    return [
      { id: 'flat', name: 'Flat Rate', description: 'Single percentage applied to all income' },
      { id: 'progressive_uk', name: 'UK PAYE', description: 'UK tax brackets (2023/24)' },
      { id: 'progressive_us', name: 'US Federal', description: 'US Federal brackets (2023)' },
      { id: 'progressive_generic', name: 'Generic Progressive', description: 'Customizable brackets' }
    ];
  }
}

module.exports = new TaxCalculationService();