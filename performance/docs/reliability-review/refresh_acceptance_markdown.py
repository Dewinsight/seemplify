"""Keep the Markdown report and coverage table aligned with reviewed report data.

This command does not generate a PDF, authenticate, or run acceptance checks.
"""
from pathlib import Path
import json

HERE = Path(__file__).resolve().parent
data = json.loads((HERE / 'ACCEPTANCE_REPORT_DATA.json').read_text(encoding='utf-8'))
pages = json.loads((HERE / 'ACCEPTANCE_REPORT_PAGES.json').read_text(encoding='utf-8'))

def table(headers, rows):
    return ['| ' + ' | '.join(headers) + ' |', '|' + '---|' * len(headers)] + [
        '| ' + ' | '.join(str(cell).replace('|', '/') for cell in row) + ' |' for row in rows
    ]

status = data.get('currentSummary', data['status'])
boundaries = data.get('providerBoundary', 'Native print output, two-browser device audio/video, recording/transcription, '
              'and genuinely connected AI/calendar/LMS/email providers remain unverified. '
              'Generated two-peer audio/video over TURN is verified separately.')
role_headers = ['Role', 'Completed transactions', 'Evidence boundary / remaining']
report_title = '# Performance Manager - verified work and evidence limits' if data.get('reportFinalized') else '# Performance Manager - illustrated acceptance report'
lines = [report_title, '', status, '']
for number, page in enumerate(pages, 1):
    lines += [f"## {number}. {page['title']}", '', f"**{page['tag']}**", '']
    for title, body in page['facts']:
        lines += [f'**{title}.** {body}', '']
    lines += [f"![{page['caption']}](report-assets/{page['image']}.png)", '', page['note'], '']
lines += [f'## {len(pages)+1}. Role coverage and evidence boundaries', ''] + table(role_headers, data['roles'])
lines += ['', '## Evidence appendix', '',
          'CI counts cover controlled UI tests and a disposable API/Mongo browser suite. '
          'They are separate from the production browser journeys and ordinary OIDC production proofs named on these pages.', '',
          '[Optional CV request/upload](CV_FEATURE_ACCEPTANCE.md) has its own accepted request-to-evidence scope; '
          'its source, real browser and independent authorization receipts are distinct from the original feature audit.', '',
          '[Surface coverage](PRODUCTION_COVERAGE_MATRIX.md) maps 23 feature groups and 68 existing routes. '
          '[Release gates](POST_DEPLOYMENT_REPLAY.md) distinguish the current release from earlier receipts. '
          'Original failures and corrected harness assumptions remain in '
          '[the receipt appendix](PRODUCTION_ROLE_RECEIPT.md) and immutable private evidence.', '', boundaries, '']
(HERE / 'PERFORMANCE_FULL_ROLE_ACCEPTANCE.md').write_text('\n'.join(lines), encoding='utf-8')

matrix = ['# Production coverage matrix', '', status, ''] + table(role_headers, data['roles'])
matrix += [''] + table(['Group', 'Surface', 'Evidence layer', 'Verified', 'Boundary / remaining'], data['features'])
matrix += ['', '[Existing UI/API catalogue](EXISTING_SURFACE_CATALOG.md) distinguishes actual controls from API-only transitions. '
           '[Current release gates](POST_DEPLOYMENT_REPLAY.md) names remaining work. '
           'Historical receipts stay in [the appendix](PRODUCTION_ROLE_RECEIPT.md).', '', boundaries, '']
(HERE / 'PRODUCTION_COVERAGE_MATRIX.md').write_text('\n'.join(matrix), encoding='utf-8')
print('Markdown report and coverage matrix refreshed; no PDF, network call or acceptance run.')
