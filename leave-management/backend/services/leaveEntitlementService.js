const LEGACY_LEAVE_TYPES = Object.freeze([
  { key: 'annual', name: 'Annual Leave', defaultDays: 20, paid: true, order: 10 },
  { key: 'sick', name: 'Sick Leave', defaultDays: 10, paid: true, order: 20 },
  { key: 'personal', name: 'Personal Leave', defaultDays: 5, paid: true, order: 30 },
  { key: 'maternity', name: 'Maternity Leave', defaultDays: 90, paid: true, order: 40 },
  { key: 'paternity', name: 'Paternity Leave', defaultDays: 14, paid: true, order: 50 },
  { key: 'unpaid', name: 'Unpaid Leave', defaultDays: 30, paid: false, order: 60 },
]);

const LEGACY_POLICY_FIELDS = Object.freeze({
  annual: 'annualLeaveDays',
  sick: 'sickLeaveDays',
  personal: 'personalLeaveDays',
  maternity: 'maternityLeaveDays',
  paternity: 'paternityLeaveDays',
  unpaid: 'unpaidLeaveDays',
});

function normalizeLeaveTypeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function getDefaultLeaveTypes(policy = {}) {
  return LEGACY_LEAVE_TYPES.map((definition) => {
    const legacyField = LEGACY_POLICY_FIELDS[definition.key];
    const configuredDays = Number(policy[legacyField]);
    return {
      ...definition,
      defaultDays: Number.isFinite(configuredDays) ? configuredDays : definition.defaultDays,
      description: '',
      active: true,
      requiresApproval: null,
    };
  });
}

function serializeLeaveType(definition) {
  return {
    key: definition.key,
    name: definition.name,
    description: definition.description || '',
    defaultDays: Number(definition.defaultDays || 0),
    paid: definition.paid !== false,
    active: definition.active !== false,
    requiresApproval: definition.requiresApproval ?? null,
    order: Number(definition.order || 0),
    createdAt: definition.createdAt || null,
    createdBy: definition.createdBy || null,
    updatedAt: definition.updatedAt || null,
    updatedBy: definition.updatedBy || null,
  };
}

function getPolicyLeaveTypes(policy, { includeInactive = false } = {}) {
  const source = Array.isArray(policy?.leaveTypes) && policy.leaveTypes.length > 0
    ? policy.leaveTypes
    : getDefaultLeaveTypes(policy || {});

  return source
    .map(serializeLeaveType)
    .filter((definition) => includeInactive || definition.active)
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
}

function legacyBalanceFor(balance, key) {
  const value = balance?.[key];
  if (!value) return null;
  return {
    leaveTypeKey: key,
    total: Number(value.total || 0),
    used: Number(value.used || 0),
    pending: Number(value.pending || 0),
    remaining: Number(value.total || 0) - Number(value.used || 0),
  };
}

function synchronizeEntitlements(balance, policy) {
  const definitions = getPolicyLeaveTypes(policy, { includeInactive: true });
  const existing = Array.isArray(balance.entitlements) ? balance.entitlements : [];
  const existingByKey = new Map(existing.map((entry) => [entry.leaveTypeKey, entry]));
  let changed = false;

  for (const definition of definitions) {
    let entry = existingByKey.get(definition.key);
    if (!entry) {
      const legacy = legacyBalanceFor(balance, definition.key);
      const migratedOverride = legacy && Number(legacy.total) !== Number(definition.defaultDays);
      balance.entitlements.push({
        leaveTypeKey: definition.key,
        leaveTypeName: definition.name,
        total: legacy?.total ?? definition.defaultDays,
        used: legacy?.used ?? 0,
        pending: legacy?.pending ?? 0,
        remaining: legacy?.remaining ?? definition.defaultDays,
        policyDefault: definition.defaultDays,
        source: migratedOverride ? 'override' : 'policy',
        overrideReason: migratedOverride ? 'Migrated from an existing individual balance' : '',
      });
      entry = balance.entitlements[balance.entitlements.length - 1];
      existingByKey.set(definition.key, entry);
      changed = true;
    }

    if (entry.leaveTypeName !== definition.name) {
      entry.leaveTypeName = definition.name;
      changed = true;
    }
    if (Number(entry.policyDefault) !== definition.defaultDays) {
      entry.policyDefault = definition.defaultDays;
      changed = true;
    }
    if (entry.source !== 'override' && Number(entry.total) !== definition.defaultDays) {
      entry.total = definition.defaultDays;
      changed = true;
    }
    const remaining = Number(entry.total || 0) - Number(entry.used || 0);
    if (Number(entry.remaining) !== remaining) {
      entry.remaining = remaining;
      changed = true;
    }
  }

  return changed;
}

function serializeBalance(balance, policy) {
  const definitions = getPolicyLeaveTypes(policy, { includeInactive: true });
  const activeByKey = new Map(definitions.map((definition) => [definition.key, definition.active]));
  const entitlements = (balance.entitlements || []).map((entry) => ({
    leaveTypeKey: entry.leaveTypeKey,
    leaveTypeName: entry.leaveTypeName,
    total: Number(entry.total || 0),
    used: Number(entry.used || 0),
    pending: Number(entry.pending || 0),
    remaining: Number(entry.total || 0) - Number(entry.used || 0),
    available: Number(entry.total || 0) - Number(entry.used || 0) - Number(entry.pending || 0),
    policyDefault: Number(entry.policyDefault || 0),
    source: entry.source || 'policy',
    overrideReason: entry.overrideReason || '',
    lastAdjustedAt: entry.lastAdjustedAt || null,
    lastAdjustedBy: entry.lastAdjustedBy || null,
    active: activeByKey.get(entry.leaveTypeKey) !== false,
  }));

  const raw = typeof balance.toObject === 'function' ? balance.toObject() : { ...balance };
  return { ...raw, entitlements };
}

module.exports = {
  LEGACY_LEAVE_TYPES,
  LEGACY_POLICY_FIELDS,
  getDefaultLeaveTypes,
  getPolicyLeaveTypes,
  normalizeLeaveTypeKey,
  serializeBalance,
  synchronizeEntitlements,
};
