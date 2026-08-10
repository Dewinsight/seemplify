let runtimeState = Object.freeze({
  ready: true,
  code: null,
  message: null,
});

function markExchangeRatesReady() {
  runtimeState = Object.freeze({ ready: true, code: null, message: null });
  return runtimeState;
}

function markExchangeRatesBlocked(details = {}) {
  runtimeState = Object.freeze({
    ready: false,
    code: details.code || 'EXCHANGE_RATE_HISTORY_REVIEW_REQUIRED',
    message: 'Cross-currency payroll is unavailable while conflicting historical exchange rates are reviewed.',
  });
  return runtimeState;
}

function getExchangeRateRuntimeState() {
  return runtimeState;
}

function assertExchangeRatesReady() {
  if (runtimeState.ready) return;

  const error = new Error(runtimeState.message);
  error.code = runtimeState.code;
  error.statusCode = 503;
  throw error;
}

module.exports = {
  markExchangeRatesReady,
  markExchangeRatesBlocked,
  getExchangeRateRuntimeState,
  assertExchangeRatesReady,
};
