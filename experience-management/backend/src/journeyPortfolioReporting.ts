import type { DatabaseRuntime } from './databaseAdapter.js';
import { db } from './database.js';
import { listJourneyPortfolioItems } from './journeyPortfolio.js';

export type JourneyPortfolioExecutiveReport = ReturnType<typeof buildJourneyPortfolioExecutiveReport>;

type CountRow = { key: string; count: number };

function counts(runtime: DatabaseRuntime, sql: string, spaceId: string): CountRow[] {
  return (runtime.prepare(sql).all(spaceId) as Array<{ key: string; count: number }>).map((row) => ({
    key: String(row.key), count: Number(row.count)
  }));
}

export function buildJourneyPortfolioExecutiveReport(input: {
  spaceId: string; actorUserId: string; asOf?: Date | string; runtime?: DatabaseRuntime;
}) {
  // Reuse the canonical read boundary for entitlement and membership checks.
  listJourneyPortfolioItems({ spaceId: input.spaceId, actorUserId: input.actorUserId, limit: 1 });
  const runtime = input.runtime ?? db;
  const asOf = new Date(input.asOf ?? Date.now());
  if (!Number.isFinite(asOf.valueOf())) throw new Error('Portfolio report time is invalid.');
  const asOfIso = asOf.toISOString(); const asOfDate = asOfIso.slice(0, 10);
  const total = Number((runtime.prepare(`SELECT COUNT(*) count FROM journey_portfolio_items
    WHERE space_id=? AND state='active'`).get(input.spaceId) as any)?.count || 0);
  const byKind = counts(runtime, `SELECT kind key,COUNT(*) count FROM journey_portfolio_items
    WHERE space_id=? AND state='active' GROUP BY kind ORDER BY kind`, input.spaceId);
  const byLifecycle = counts(runtime, `SELECT lifecycle key,COUNT(*) count FROM journey_portfolio_items
    WHERE space_id=? AND state='active' GROUP BY lifecycle ORDER BY lifecycle`, input.spaceId);
  const initiatives = runtime.prepare(`SELECT
      COUNT(*) total,
      SUM(CASE WHEN owner_user_id IS NOT NULL OR owner_team_id IS NOT NULL THEN 1 ELSE 0 END) owned,
      SUM(CASE WHEN due_date IS NOT NULL AND due_date<? AND lifecycle NOT IN ('completed','cancelled','archived') THEN 1 ELSE 0 END) overdue,
      SUM(CASE WHEN progress_percent IS NOT NULL THEN 1 ELSE 0 END) progress_known,
      AVG(progress_percent) average_progress
    FROM journey_portfolio_items WHERE space_id=? AND state='active' AND kind='initiative'`)
    .get(asOfDate, input.spaceId) as any;
  const evidence = runtime.prepare(`SELECT
      COUNT(*) total,
      SUM(CASE WHEN EXISTS(SELECT 1 FROM journey_portfolio_item_evidence evidence
        WHERE evidence.item_id=item.id AND evidence.space_id=item.space_id) THEN 1 ELSE 0 END) with_evidence,
      SUM(CASE WHEN EXISTS(SELECT 1 FROM journey_portfolio_priority_assessments assessment
        WHERE assessment.item_id=item.id AND assessment.space_id=item.space_id) THEN 1 ELSE 0 END) scored
    FROM journey_portfolio_items item WHERE item.space_id=? AND item.state='active'`).get(input.spaceId) as any;
  const delivery = runtime.prepare(`SELECT
      (SELECT COUNT(*) FROM journey_initiative_dependencies WHERE space_id=?) dependencies,
      (SELECT COUNT(DISTINCT initiative_id) FROM journey_initiative_baselines WHERE space_id=?) initiatives_with_baseline,
      (SELECT COUNT(DISTINCT initiative_id) FROM journey_initiative_outcome_comparisons WHERE space_id=?) initiatives_with_comparison,
      (SELECT COUNT(*) FROM journey_portfolio_operational_links WHERE space_id=?) operational_links`)
    .get(input.spaceId, input.spaceId, input.spaceId, input.spaceId) as any;
  const outcomeDirections = counts(runtime, `SELECT COALESCE(comparison_json->>'directionalResult','unknown') key,COUNT(*) count
    FROM journey_initiative_outcome_comparisons WHERE space_id=? GROUP BY key ORDER BY key`, input.spaceId);
  const operationalOutcomes = counts(runtime, `SELECT outcome_state key,COUNT(*) count FROM journey_portfolio_operational_links
    WHERE space_id=? GROUP BY outcome_state ORDER BY outcome_state`, input.spaceId);
  return Object.freeze({
    schemaVersion: 'journey-portfolio-executive-report/v1' as const, asOf: asOfIso,
    scope: Object.freeze({ state: 'active' as const, itemCount: total }),
    items: Object.freeze({ byKind, byLifecycle,
      withEvidence: Number(evidence?.with_evidence || 0), scored: Number(evidence?.scored || 0) }),
    initiatives: Object.freeze({ total: Number(initiatives?.total || 0), owned: Number(initiatives?.owned || 0),
      overdue: Number(initiatives?.overdue || 0), progressKnown: Number(initiatives?.progress_known || 0),
      averageProgress: initiatives?.average_progress == null ? null : Number(Number(initiatives.average_progress).toFixed(2)),
      dependencies: Number(delivery?.dependencies || 0), initiativesWithBaseline: Number(delivery?.initiatives_with_baseline || 0),
      initiativesWithComparison: Number(delivery?.initiatives_with_comparison || 0),
      operationalLinks: Number(delivery?.operational_links || 0) }),
    observedOutcomes: Object.freeze({ directionalComparisons: outcomeDirections, operationalOutcomes }),
    interpretation: Object.freeze({ mode: 'descriptive_portfolio_snapshot' as const,
      statement: 'Counts and before/after observations describe recorded portfolio state. They do not establish causation.' })
  });
}

function csvCell(value: unknown) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportJourneyPortfolioExecutiveReport(report: JourneyPortfolioExecutiveReport) {
  const rows: Array<[string, string, number | string | null]> = [
    ['scope', 'active_items', report.scope.itemCount],
    ...report.items.byKind.map((row) => ['kind', row.key, row.count] as [string, string, number]),
    ...report.items.byLifecycle.map((row) => ['lifecycle', row.key, row.count] as [string, string, number]),
    ['coverage', 'items_with_evidence', report.items.withEvidence], ['coverage', 'scored_items', report.items.scored],
    ['initiatives', 'total', report.initiatives.total], ['initiatives', 'owned', report.initiatives.owned],
    ['initiatives', 'overdue', report.initiatives.overdue], ['initiatives', 'progress_known', report.initiatives.progressKnown],
    ['initiatives', 'average_progress', report.initiatives.averageProgress],
    ['delivery', 'dependencies', report.initiatives.dependencies],
    ['delivery', 'initiatives_with_baseline', report.initiatives.initiativesWithBaseline],
    ['delivery', 'initiatives_with_comparison', report.initiatives.initiativesWithComparison],
    ['delivery', 'operational_links', report.initiatives.operationalLinks],
    ...report.observedOutcomes.directionalComparisons.map((row) => ['observed_comparison', row.key, row.count] as [string, string, number]),
    ...report.observedOutcomes.operationalOutcomes.map((row) => ['operational_outcome', row.key, row.count] as [string, string, number])
  ];
  return Buffer.from(`category,metric,value,as_of\r\n${rows.map((row) => [...row, report.asOf].map(csvCell).join(',')).join('\r\n')}\r\n`, 'utf8');
}
