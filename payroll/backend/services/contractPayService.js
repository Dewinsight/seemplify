function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function startOfDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Payroll periods are calendar dates. UTC normalization avoids DST changing
  // the number of contract days when a period crosses a clock change.
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function daysInclusive(start, end) {
  const from = startOfDay(start);
  const to = startOfDay(end);
  if (!from || !to || to < from) return 0;
  return Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
}

function getContractOverlap(workTerms = {}, payStart, payEnd) {
  const periodStart = startOfDay(payStart);
  const periodEnd = startOfDay(payEnd);
  const contractStart = startOfDay(workTerms.contractStartDate) || periodStart;
  const contractEnd = startOfDay(workTerms.contractEndDate) || periodEnd;

  if (!periodStart || !periodEnd || contractEnd < periodStart || contractStart > periodEnd) {
    return { active: false, overlapDays: 0, contractDays: 0 };
  }

  const overlapStart = contractStart > periodStart ? contractStart : periodStart;
  const overlapEnd = contractEnd < periodEnd ? contractEnd : periodEnd;
  return {
    active: true,
    overlapDays: daysInclusive(overlapStart, overlapEnd),
    contractDays: daysInclusive(contractStart, contractEnd),
    overlapStart,
    overlapEnd,
  };
}

function calculateContractBasePay(profile, payPeriod, workInput = {}) {
  const workTerms = profile?.workTerms || {};
  const payBasis = workTerms.payBasis || 'salary';
  const rate = Math.max(0, toNumber(workTerms.rate));
  const usesContractPeriod = payBasis === 'fixed_contract'
    || profile?.employeeInfo?.employmentType === 'contract';
  // Contract dates can remain on legacy profiles after an employee moves to a
  // normal salary basis. Do not let those hidden, stale values exclude a
  // permanent employee from payroll.
  const overlap = getContractOverlap(
    usesContractPeriod ? workTerms : {},
    payPeriod.startDate,
    payPeriod.endDate
  );

  if (!overlap.active) {
    return { eligible: false, amount: 0, payBasis, rate, units: 0, unitLabel: '' };
  }

  if (payBasis === 'hourly') {
    const units = Math.max(0, toNumber(workInput.regularHours));
    if (units <= 0) throw new Error('Regular hours are required for hourly-paid staff');
    return { eligible: true, amount: roundMoney(rate * units), payBasis, rate, units, unitLabel: 'hours' };
  }

  if (payBasis === 'daily') {
    const units = Math.max(0, toNumber(workInput.daysWorked));
    if (units <= 0) throw new Error('Days worked are required for daily-paid staff');
    return { eligible: true, amount: roundMoney(rate * units), payBasis, rate, units, unitLabel: 'days' };
  }

  if (payBasis === 'fixed_contract') {
    const contractAmount = Math.max(0, toNumber(workTerms.contractAmount));
    if (contractAmount <= 0) throw new Error('A contract amount is required for fixed-contract staff');
    const amount = workTerms.contractAmountFrequency === 'pay_period'
      ? contractAmount
      : contractAmount * (overlap.overlapDays / Math.max(1, overlap.contractDays));
    return {
      eligible: true,
      amount: roundMoney(amount),
      payBasis,
      rate: contractAmount,
      units: overlap.overlapDays,
      unitLabel: workTerms.contractAmountFrequency === 'pay_period' ? 'pay period' : 'contract days',
    };
  }

  return {
    eligible: true,
    amount: Math.max(0, toNumber(profile?.basicSalary)),
    payBasis: 'salary',
    rate: Math.max(0, toNumber(profile?.basicSalary)),
    units: 1,
    unitLabel: 'pay period',
  };
}

function hasPayConfiguration(profile = {}) {
  const payBasis = profile?.workTerms?.payBasis || 'salary';
  if (payBasis === 'salary') return toNumber(profile.basicSalary) > 0;
  if (payBasis === 'fixed_contract') return toNumber(profile?.workTerms?.contractAmount) > 0;
  return toNumber(profile?.workTerms?.rate) > 0;
}

module.exports = {
  calculateContractBasePay,
  getContractOverlap,
  hasPayConfiguration,
};
