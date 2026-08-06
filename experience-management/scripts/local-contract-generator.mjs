/** Temporary development helper: derive runtime-27/28/29 contract source from an
 * applied disposable database. Not part of the shipped harness. */

const FAMILIES = [
  ['journeyPortfolio', 27, [
    'journey_portfolio_settings', 'journey_portfolio_items', 'journey_portfolio_item_versions',
    'journey_portfolio_item_evidence', 'journey_portfolio_item_tags', 'journey_initiative_metric_targets',
    'journey_portfolio_relationships', 'journey_portfolio_journey_links', 'journey_initiative_dependencies',
    'journey_portfolio_scoring_policies', 'journey_portfolio_scoring_policy_versions',
    'journey_portfolio_priority_assessments', 'journey_initiative_baselines',
    'journey_initiative_outcome_comparisons', 'journey_portfolio_reviews',
    'journey_portfolio_operational_links', 'journey_portfolio_operations', 'journey_portfolio_activity'
  ]],
  ['journeyCollaboration', 28, [
    'journey_collaboration_settings', 'journey_collaboration_role_assignments',
    'journey_collaboration_role_events', 'journey_comments', 'journey_comment_versions',
    'journey_comment_mentions', 'journey_collaboration_watchers', 'journey_governance_reviews',
    'journey_governance_review_events', 'journey_governance_publications',
    'journey_collaboration_notifications', 'journey_collaboration_notification_states',
    'journey_collaboration_notification_state_events', 'journey_collaboration_views',
    'journey_read_only_shares', 'journey_share_access_events', 'journey_share_rate_buckets',
    'journey_collaboration_operations', 'journey_collaboration_activity', 'journey_collaboration_audit_events'
  ]],
  ['journeyHierarchyBlueprint', 29, [
    'journey_hierarchy_settings', 'journey_taxonomy_terms', 'journey_definition_taxonomy',
    'journey_hierarchy_links', 'journey_hierarchy_health_policies', 'journey_hierarchy_health_snapshots',
    'journey_blueprint_resources', 'journey_blueprints', 'journey_blueprint_versions',
    'journey_blueprint_stages', 'journey_blueprint_elements', 'journey_blueprint_element_resources',
    'journey_blueprint_relationships', 'journey_blueprint_portfolio_links',
    'journey_blueprint_gap_assessments', 'journey_blueprint_comparisons', 'journey_hierarchy_operations',
    'journey_hierarchy_activity'
  ]]
];

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const normalized = (value) => String(value || '').toLowerCase().replace(/\s+/gu, ' ').trim();
const js = (value) => JSON.stringify(value).replaceAll("'", "\\u0027").replace(/^"|"$/gu, '');
const quote = (value) => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

async function rows(query, sql) {
  const result = await query(sql);
  return Array.isArray(result) ? result : result?.rows || [];
}

export async function generateRuntimeContractSource(query) {
  const all = FAMILIES.flatMap((entry) => entry[2]);
  const list = all.map(literal).join(',');

  const columnRows = await rows(query, `SELECT table_name,column_name,data_type,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema='public' AND table_name IN (${list})
    ORDER BY table_name,ordinal_position`);
  const pkRows = await rows(query, `SELECT rel.relname table_name,array_agg(att.attname ORDER BY keys.ordinality) columns
    FROM pg_constraint c JOIN pg_class rel ON rel.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=rel.relnamespace
    JOIN unnest(c.conkey) WITH ORDINALITY keys(attnum,ordinality) ON TRUE
    JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attnum=keys.attnum
    WHERE n.nspname='public' AND c.contype='p' AND rel.relname IN (${list})
    GROUP BY rel.relname`);
  const fkRows = await rows(query, `SELECT src.relname table_name,sa.attname column_name,
      tgt.relname referenced_table,ta.attname referenced_column,c.confdeltype delete_action
    FROM pg_constraint c JOIN pg_class src ON src.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=src.relnamespace JOIN pg_class tgt ON tgt.oid=c.confrelid
    JOIN unnest(c.conkey,c.confkey) pairs(sn,tn) ON TRUE
    JOIN pg_attribute sa ON sa.attrelid=src.oid AND sa.attnum=pairs.sn
    JOIN pg_attribute ta ON ta.attrelid=tgt.oid AND ta.attnum=pairs.tn
    WHERE n.nspname='public' AND c.contype='f' AND src.relname IN (${list})
    ORDER BY src.relname,sa.attname,tgt.relname,ta.attname`);
  // Constraint-backing indexes are excluded: they are already pinned by the
  // primary-key and named-constraint contracts, and PostgreSQL names them.
  const indexRows = await rows(query, `SELECT i.tablename,i.indexname,i.indexdef FROM pg_indexes i
    WHERE i.schemaname='public' AND i.tablename IN (${list})
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c
        JOIN pg_class idx ON idx.oid=c.conindid
        JOIN pg_namespace n ON n.oid=idx.relnamespace
        WHERE n.nspname='public' AND idx.relname=i.indexname)
    ORDER BY i.tablename,i.indexname`);
  const checkRows = await rows(query, `SELECT rel.relname table_name,c.conname,
      pg_get_constraintdef(c.oid,true) definition
    FROM pg_constraint c JOIN pg_class rel ON rel.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=rel.relnamespace
    WHERE n.nspname='public' AND c.contype='c' AND rel.relname IN (${list})
    ORDER BY rel.relname,c.conname`);
  // Composite keys only: a single-column foreign key is already pinned exactly by
  // RequiredForeignKeys (table, column, target, action). What that per-column
  // shape cannot express is the grouping -- which columns travel together -- and
  // that grouping is the whole tenant-isolation guarantee.
  const namedRows = await rows(query, `SELECT rel.relname table_name,c.conname,
      pg_get_constraintdef(c.oid,true) definition
    FROM pg_constraint c JOIN pg_class rel ON rel.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=rel.relnamespace
    WHERE n.nspname='public' AND c.contype IN ('f','u') AND rel.relname IN (${list})
      AND array_length(c.conkey,1)>1
    ORDER BY c.conname`);
  const triggerRows = await rows(query, `SELECT t.tgname,rel.relname table_name,p.proname function_name
    FROM pg_trigger t JOIN pg_class rel ON rel.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=rel.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE n.nspname='public' AND NOT t.tgisinternal AND rel.relname IN (${list})
    ORDER BY t.tgname`);

  const owner = new Map();
  for (const [, , tables] of FAMILIES) for (const table of tables) owner.set(table, tables);
  const pick = (tables, rowsIn, key) => rowsIn.filter((row) => tables.includes(String(row[key])));

  let out = '';
  for (const [prefix, version, tables] of FAMILIES) {
    const columns = new Map();
    for (const row of pick(tables, columnRows, 'table_name')) {
      const entry = columns.get(String(row.table_name)) || [];
      entry.push([String(row.column_name), String(row.data_type), String(row.is_nullable) === 'YES']);
      columns.set(String(row.table_name), entry);
    }
    const wrap = (entries, indent) => {
      const lines = [];
      let line = '';
      for (const entry of entries) {
        if (line && `${line}${entry},`.length > 108) { lines.push(line); line = ''; }
        line += `${entry},`;
      }
      if (line) lines.push(line);
      return lines.map((value) => `${indent}${value}`).join('\n');
    };
    out += `const ${prefix}ExactColumns = Object.freeze({\n`;
    for (const table of tables) {
      const entry = (columns.get(table) || []).map((c) => `[${quote(c[0])},${quote(c[1])},${c[2]}]`);
      out += `  ${table}: [\n${wrap(entry, '    ')}\n  ],\n`;
    }
    out += `});\n`;

    out += `const ${prefix}PrimaryKeys = Object.freeze({\n`;
    for (const row of pick(tables, pkRows, 'table_name')) {
      const cols = String(row.columns).replace(/^\{|\}$/gu, '').split(',').filter(Boolean)
        .map((c) => quote(c.replace(/^"|"$/gu, '')));
      out += `  ${row.table_name}: [${cols.join(',')}],\n`;
    }
    out += `});\n`;

    out += `const ${prefix}RequiredForeignKeys = Object.freeze([\n`;
    for (const row of pick(tables, fkRows, 'table_name')) {
      out += `  [${quote(row.table_name)},${quote(row.column_name)},${quote(row.referenced_table)},${quote(row.referenced_column)},${quote(row.delete_action)}],\n`;
    }
    out += `]);\n`;

    out += `const ${prefix}RequiredIndexes = Object.freeze({\n`;
    for (const row of pick(tables, indexRows, 'tablename')) {
      out += `  ${row.indexname}: [${quote(normalized(row.indexdef))}],\n`;
    }
    out += `});\n`;

    out += `const ${prefix}RequiredDefaults = Object.freeze({\n`;
    for (const row of pick(tables, columnRows, 'table_name')) {
      if (row.column_default === null || row.column_default === undefined) continue;
      out += `  '${row.table_name}.${row.column_name}': ${quote(normalized(row.column_default))},\n`;
    }
    out += `});\n`;

    const checks = new Map();
    for (const row of pick(tables, checkRows, 'table_name')) {
      const entry = checks.get(String(row.table_name)) || [];
      entry.push(normalized(row.definition));
      checks.set(String(row.table_name), entry);
    }
    out += `const ${prefix}RequiredChecks = Object.freeze({\n`;
    for (const [table, entry] of checks) {
      out += `  ${table}: [\n${entry.map((d) => `    [${quote(d)}]`).join(',\n')}\n  ],\n`;
    }
    out += `});\n`;

    out += `const ${prefix}RequiredConstraints = Object.freeze({\n`;
    for (const row of pick(tables, namedRows, 'table_name')) {
      out += `  ${row.conname}: [${quote(normalized(row.definition))}],\n`;
    }
    out += `});\n`;

    out += `const ${prefix}RequiredTriggers = Object.freeze({\n`;
    for (const row of pick(tables, triggerRows, 'table_name')) {
      out += `  ${row.tgname}: [${quote(row.table_name)},${quote(row.function_name)}],\n`;
    }
    out += `});\n`;
    out += `export const ${prefix}RuntimeContract = Object.freeze({\n`
      + `  columns: ${prefix}ExactColumns, primaryKeys: ${prefix}PrimaryKeys,\n`
      + `  foreignKeys: ${prefix}RequiredForeignKeys, indexes: ${prefix}RequiredIndexes,\n`
      + `  defaults: ${prefix}RequiredDefaults, checks: ${prefix}RequiredChecks,\n`
      + `  constraints: ${prefix}RequiredConstraints, triggers: ${prefix}RequiredTriggers\n`
      + `});\n// runtime ${version}\n\n`;
  }
  void js;
  void owner;
  return out;
}
