const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export const RUNTIME_EXTENSION_TABLES = Object.freeze([
  'experience_runtime_schema_version',
  'platform_role_assignments',
  'platform_subscription_requests',
  'platform_subscriptions',
  'platform_subscription_events',
  'platform_audit_events',
  'ticket_events'
]);

const exactColumns = Object.freeze({
  experience_runtime_schema_version: [
    ['version', 'integer', false], ['name', 'text', false], ['checksum', 'text', false], ['applied_at', 'text', false]
  ],
  platform_role_assignments: [
    ['id', 'text', false], ['user_id', 'text', false], ['role', 'text', false], ['granted_by_user_id', 'text', true],
    ['granted_at', 'text', false], ['revoked_by_user_id', 'text', true], ['revoked_at', 'text', true], ['reason', 'text', true]
  ],
  platform_subscription_requests: [
    ['id', 'text', false], ['space_id', 'text', false], ['request_type', 'text', false], ['requested_plan_code', 'text', true],
    ['request_note', 'text', false], ['plan_snapshot_json', 'text', false], ['status', 'text', false],
    ['requested_by_user_id', 'text', false], ['reviewed_by_user_id', 'text', true], ['review_note', 'text', true],
    ['decision_at', 'text', true], ['version', 'integer', false], ['created_at', 'text', false], ['updated_at', 'text', false]
  ],
  platform_subscriptions: [
    ['id', 'text', false], ['space_id', 'text', false], ['plan_code', 'text', false], ['status', 'text', false],
    ['features_json', 'text', false], ['limits_json', 'text', false], ['source_request_id', 'text', true],
    ['approved_by_user_id', 'text', true], ['effective_at', 'text', false], ['expires_at', 'text', true],
    ['version', 'integer', false], ['created_at', 'text', false], ['updated_at', 'text', false]
  ],
  platform_subscription_events: [
    ['id', 'text', false], ['space_id', 'text', false], ['subscription_id', 'text', true], ['request_id', 'text', true],
    ['event_type', 'text', false], ['actor_user_id', 'text', true], ['metadata_json', 'text', false], ['created_at', 'text', false]
  ],
  platform_audit_events: [
    ['id', 'text', false], ['actor_user_id', 'text', true], ['actor_role', 'text', true], ['action', 'text', false],
    ['target_type', 'text', false], ['target_id', 'text', false], ['space_id', 'text', true], ['reason', 'text', true],
    ['before_json', 'text', true], ['after_json', 'text', true], ['request_id', 'text', true], ['ip_address', 'text', true],
    ['user_agent', 'text', true], ['created_at', 'text', false]
  ],
  ticket_events: [
    ['id', 'text', false], ['ticket_id', 'text', false], ['actor_user_id', 'text', true], ['event_type', 'text', false],
    ['detail_json', 'text', false], ['created_at', 'text', false]
  ]
});

const additiveColumns = Object.freeze({
  users: [
    ['account_status', 'text', false], ['last_login_at', 'text', true], ['suspended_at', 'text', true],
    ['suspended_by_user_id', 'text', true], ['suspension_reason', 'text', true]
  ],
  spaces: [
    ['status', 'text', false], ['suspended_at', 'text', true], ['suspended_by_user_id', 'text', true],
    ['suspension_reason', 'text', true]
  ]
});

const primaryKeys = Object.freeze({
  experience_runtime_schema_version: ['version'],
  platform_role_assignments: ['id'],
  platform_subscription_requests: ['id'],
  platform_subscriptions: ['id'],
  platform_subscription_events: ['id'],
  platform_audit_events: ['id'],
  ticket_events: ['id']
});

const requiredForeignKeys = Object.freeze([
  ['users', 'suspended_by_user_id', 'users', 'id', 'n'],
  ['spaces', 'suspended_by_user_id', 'users', 'id', 'n'],
  ['platform_role_assignments', 'user_id', 'users', 'id', 'c'],
  ['platform_role_assignments', 'granted_by_user_id', 'users', 'id', 'n'],
  ['platform_role_assignments', 'revoked_by_user_id', 'users', 'id', 'n'],
  ['platform_subscription_requests', 'space_id', 'spaces', 'id', 'c'],
  ['platform_subscription_requests', 'requested_by_user_id', 'users', 'id', 'r'],
  ['platform_subscription_requests', 'reviewed_by_user_id', 'users', 'id', 'n'],
  ['platform_subscriptions', 'space_id', 'spaces', 'id', 'c'],
  ['platform_subscriptions', 'source_request_id', 'platform_subscription_requests', 'id', 'n'],
  ['platform_subscriptions', 'approved_by_user_id', 'users', 'id', 'n'],
  ['platform_subscription_events', 'space_id', 'spaces', 'id', 'c'],
  ['platform_subscription_events', 'subscription_id', 'platform_subscriptions', 'id', 'n'],
  ['platform_subscription_events', 'request_id', 'platform_subscription_requests', 'id', 'n'],
  ['platform_subscription_events', 'actor_user_id', 'users', 'id', 'n'],
  ['platform_audit_events', 'actor_user_id', 'users', 'id', 'n'],
  ['platform_audit_events', 'space_id', 'spaces', 'id', 'n'],
  ['ticket_events', 'ticket_id', 'tickets', 'id', 'c'],
  ['ticket_events', 'actor_user_id', 'users', 'id', 'n']
]);

const requiredIndexes = Object.freeze({
  platform_role_assignments_active: ['create unique index', '(user_id, role)', 'where (revoked_at is null)'],
  platform_role_assignments_user: ['(user_id, granted_at desc)'],
  platform_subscription_requests_one_pending: ['create unique index', '(space_id)', "where (status = 'pending'::text)"],
  platform_subscription_requests_review: ['(status, created_at, id)'],
  platform_subscription_requests_space: ['(space_id, created_at desc, id)'],
  platform_subscriptions_one_per_space: ['create unique index', '(space_id)'],
  platform_subscriptions_space_history: ['(space_id, created_at desc, id)'],
  platform_subscription_events_space: ['(space_id, created_at desc, id)'],
  platform_subscription_events_request: ['(request_id, created_at, id)'],
  platform_audit_events_created: ['(created_at desc, id)'],
  platform_audit_events_target: ['(target_type, target_id, created_at desc, id)'],
  platform_audit_events_actor: ['(actor_user_id, created_at desc, id)'],
  platform_audit_events_space: ['(space_id, created_at desc, id)'],
  ticket_events_ticket: ['(ticket_id, created_at, id)']
});

const requiredDefaults = Object.freeze({
  'users.account_status': "'active'::text",
  'spaces.status': "'active'::text",
  'platform_subscription_requests.request_note': "''::text",
  'platform_subscription_requests.plan_snapshot_json': "'{}'::text",
  'platform_subscription_requests.status': "'pending'::text",
  'platform_subscription_requests.version': '1',
  'platform_subscriptions.status': "'active'::text",
  'platform_subscriptions.features_json': "'{}'::text",
  'platform_subscriptions.limits_json': "'{}'::text",
  'platform_subscriptions.version': '1',
  'platform_subscription_events.metadata_json': "'{}'::text",
  'ticket_events.detail_json': "'{}'::text"
});

const requiredChecks = Object.freeze({
  platform_role_assignments: [['role', 'superadmin', 'support', 'billing_approver', 'analyst']],
  platform_subscription_requests: [
    ['request_type', 'activate', 'change', 'cancel'],
    ['requested_plan_code', 'starter', 'team', 'enterprise'],
    ['status', 'pending', 'approved', 'rejected', 'cancelled'],
    ['version', '> 0']
  ],
  platform_subscriptions: [
    ['plan_code', 'starter', 'team', 'enterprise'],
    ['status', 'active', 'suspended', 'cancelled'],
    ['version', '> 0']
  ]
});

function contractError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function normalized(value) { return String(value || '').toLowerCase().replace(/\s+/gu, ' ').trim(); }
function key(parts) { return parts.join('|'); }
function textArray(value) {
  if (Array.isArray(value)) return value.map(String);
  const source = String(value || '');
  if (source.startsWith('{') && source.endsWith('}')) {
    return source.slice(1, -1).split(',').filter(Boolean).map((entry) => entry.replace(/^"|"$/gu, ''));
  }
  return source ? [source] : [];
}

async function rows(query, sql) {
  const result = await query(sql);
  return Array.isArray(result) ? result : result?.rows || [];
}

export async function assertRuntimeSchemaContract(query, options = {}) {
  const schema = String(options.schema || 'public');
  if (!IDENTIFIER.test(schema)) throw contractError('RUNTIME_SCHEMA_IDENTIFIER_INVALID', `Unsafe PostgreSQL schema identifier: ${schema}`);

  const columnRows = await rows(query, `SELECT table_name,column_name,data_type,is_nullable,column_default,ordinal_position
    FROM information_schema.columns WHERE table_schema=${sqlLiteral(schema)}
      AND table_name IN (${Object.keys({ ...exactColumns, ...additiveColumns }).map(sqlLiteral).join(',')})
    ORDER BY table_name,ordinal_position`);
  const byTable = new Map();
  const defaults = new Map();
  for (const row of columnRows) {
    const list = byTable.get(String(row.table_name)) || [];
    list.push([String(row.column_name), String(row.data_type), String(row.is_nullable) === 'YES']);
    byTable.set(String(row.table_name), list);
    defaults.set(`${String(row.table_name)}.${String(row.column_name)}`, normalized(row.column_default));
  }
  for (const [table, expected] of Object.entries(exactColumns)) {
    if (JSON.stringify(byTable.get(table) || []) !== JSON.stringify(expected)) {
      throw contractError('RUNTIME_SCHEMA_COLUMN_MISMATCH', `Runtime table ${schema}.${table} does not match its exact column contract.`);
    }
  }
  for (const [table, expected] of Object.entries(additiveColumns)) {
    const actual = new Map((byTable.get(table) || []).map((column) => [column[0], column.slice(1)]));
    for (const [name, type, nullable] of expected) {
      if (JSON.stringify(actual.get(name)) !== JSON.stringify([type, nullable])) {
        throw contractError('RUNTIME_SCHEMA_COLUMN_MISMATCH', `Column ${schema}.${table}.${name} does not match its runtime contract.`);
      }
    }
  }
  for (const [column, expected] of Object.entries(requiredDefaults)) {
    if (defaults.get(column) !== normalized(expected)) {
      throw contractError('RUNTIME_SCHEMA_DEFAULT_MISMATCH', `Default for ${schema}.${column} does not match its runtime contract.`);
    }
  }

  const pkRows = await rows(query, `SELECT rel.relname table_name,array_agg(att.attname ORDER BY keys.ordinality) columns
    FROM pg_constraint constraint_record
    JOIN pg_class rel ON rel.oid=constraint_record.conrelid
    JOIN pg_namespace namespace_record ON namespace_record.oid=rel.relnamespace
    JOIN unnest(constraint_record.conkey) WITH ORDINALITY keys(attnum,ordinality) ON TRUE
    JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attnum=keys.attnum
    WHERE namespace_record.nspname=${sqlLiteral(schema)} AND constraint_record.contype='p'
      AND rel.relname IN (${Object.keys(primaryKeys).map(sqlLiteral).join(',')})
    GROUP BY rel.relname`);
  const actualPrimaryKeys = new Map(pkRows.map((row) => [String(row.table_name), textArray(row.columns)]));
  for (const [table, expected] of Object.entries(primaryKeys)) {
    if (JSON.stringify(actualPrimaryKeys.get(table) || []) !== JSON.stringify(expected)) {
      throw contractError('RUNTIME_SCHEMA_PRIMARY_KEY_MISMATCH', `Primary key for ${schema}.${table} does not match its runtime contract.`);
    }
  }

  const fkRows = await rows(query, `SELECT source.relname table_name,source_attribute.attname column_name,
      target.relname referenced_table,target_attribute.attname referenced_column,constraint_record.confdeltype delete_action
    FROM pg_constraint constraint_record
    JOIN pg_class source ON source.oid=constraint_record.conrelid
    JOIN pg_namespace namespace_record ON namespace_record.oid=source.relnamespace
    JOIN pg_class target ON target.oid=constraint_record.confrelid
    JOIN unnest(constraint_record.conkey,constraint_record.confkey) pairs(source_number,target_number) ON TRUE
    JOIN pg_attribute source_attribute ON source_attribute.attrelid=source.oid AND source_attribute.attnum=pairs.source_number
    JOIN pg_attribute target_attribute ON target_attribute.attrelid=target.oid AND target_attribute.attnum=pairs.target_number
    WHERE namespace_record.nspname=${sqlLiteral(schema)} AND constraint_record.contype='f'`);
  const actualForeignKeys = new Set(fkRows.map((row) => key([
    row.table_name, row.column_name, row.referenced_table, row.referenced_column, row.delete_action
  ].map(String))));
  for (const expected of requiredForeignKeys) {
    if (!actualForeignKeys.has(key(expected))) {
      throw contractError('RUNTIME_SCHEMA_FOREIGN_KEY_MISMATCH', `Required foreign key ${expected[0]}.${expected[1]} -> ${expected[2]}.${expected[3]} is missing or has the wrong delete action.`);
    }
  }

  const checkRows = await rows(query, `SELECT rel.relname table_name,pg_get_constraintdef(constraint_record.oid,true) definition
    FROM pg_constraint constraint_record
    JOIN pg_class rel ON rel.oid=constraint_record.conrelid
    JOIN pg_namespace namespace_record ON namespace_record.oid=rel.relnamespace
    WHERE namespace_record.nspname=${sqlLiteral(schema)} AND constraint_record.contype='c'`);
  const checksByTable = new Map();
  for (const row of checkRows) {
    const definitions = checksByTable.get(String(row.table_name)) || [];
    definitions.push(normalized(row.definition));
    checksByTable.set(String(row.table_name), definitions);
  }
  for (const [table, patterns] of Object.entries(requiredChecks)) {
    const definitions = checksByTable.get(table) || [];
    for (const fragments of patterns) {
      if (!definitions.some((definition) => fragments.every((fragment) => definition.includes(normalized(fragment))))) {
        throw contractError('RUNTIME_SCHEMA_CHECK_MISMATCH', `A required check constraint on ${schema}.${table} is missing or malformed.`);
      }
    }
  }

  const indexRows = await rows(query, `SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=${sqlLiteral(schema)}`);
  const actualIndexes = new Map(indexRows.map((row) => [String(row.indexname), normalized(row.indexdef)]));
  for (const [name, fragments] of Object.entries(requiredIndexes)) {
    const definition = actualIndexes.get(name) || '';
    if (!definition || fragments.some((fragment) => !definition.includes(normalized(fragment)))) {
      throw contractError('RUNTIME_SCHEMA_INDEX_MISMATCH', `Index ${schema}.${name} is missing or does not match its runtime contract.`);
    }
  }

  return { schema, extensionTables: RUNTIME_EXTENSION_TABLES.length, indexes: Object.keys(requiredIndexes).length };
}

export async function assertRuntimePrivileges(query, runtimeRole, options = {}) {
  const schema = String(options.schema || 'public');
  if (!IDENTIFIER.test(schema) || !IDENTIFIER.test(runtimeRole)) {
    throw contractError('RUNTIME_PRIVILEGE_IDENTIFIER_INVALID', 'Unsafe PostgreSQL schema or role identifier in privilege contract.');
  }
  const expectations = [
    ['experience_schema_version', true, false, false, false],
    ['schema_migrations', true, false, false, false],
    ['experience_runtime_schema_version', true, false, false, false],
    ['platform_audit_events', true, true, false, false],
    ['platform_subscription_events', true, true, false, false],
    ['ticket_events', true, true, false, false]
  ];
  for (const [table, select, insert, update, remove] of expectations) {
    const qualified = `${schema}.${table}`;
    const result = (await rows(query, `SELECT
      has_table_privilege(${sqlLiteral(runtimeRole)},${sqlLiteral(qualified)},'SELECT') can_select,
      has_table_privilege(${sqlLiteral(runtimeRole)},${sqlLiteral(qualified)},'INSERT') can_insert,
      has_table_privilege(${sqlLiteral(runtimeRole)},${sqlLiteral(qualified)},'UPDATE') can_update,
      has_table_privilege(${sqlLiteral(runtimeRole)},${sqlLiteral(qualified)},'DELETE') can_delete`))[0];
    const actual = [Boolean(result?.can_select), Boolean(result?.can_insert), Boolean(result?.can_update), Boolean(result?.can_delete)];
    if (JSON.stringify(actual) !== JSON.stringify([select, insert, update, remove])) {
      throw contractError('RUNTIME_PRIVILEGE_MISMATCH', `Privileges for ${runtimeRole} on ${qualified} are ${actual.join('/')}, expected ${[select, insert, update, remove].join('/')}.`);
    }
  }
  const schemaPrivilege = (await rows(query, `SELECT has_schema_privilege(${sqlLiteral(runtimeRole)},${sqlLiteral(schema)},'CREATE') can_create`))[0];
  if (Boolean(schemaPrivilege?.can_create)) {
    throw contractError('RUNTIME_PRIVILEGE_MISMATCH', `${runtimeRole} must not have CREATE on schema ${schema}.`);
  }
  return { role: runtimeRole, protectedTables: expectations.length };
}
