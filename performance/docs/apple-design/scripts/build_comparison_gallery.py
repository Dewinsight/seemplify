"""Build a dependency-free gallery from matched, unmodified browser screenshots."""
import json
import re
from html import escape
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'evidence'
coverage = json.loads((EVIDENCE / 'screen-coverage-manifest.json').read_text(encoding='utf-8-sig'))
templates = [route['template'] for route in coverage['routes']]
static = {route for route in templates if '[' not in route}

def read_capture(folder, family, filename=None):
    data = json.loads((EVIDENCE / folder / (filename or f'{family}-capture.json')).read_text(encoding='utf-8-sig'))
    rows = data.get('results', data.get('screens', []))
    result = []
    for row in rows:
        view = row.get('viewport', {})
        picture = row.get('screenshot') or f"{folder}/{row['file']}"
        result.append({
            'path': urlsplit(row.get('requestedRoute', row.get('route', ''))).path,
            'width': view.get('width', row.get('width', 0)),
            'theme': row.get('theme', 'light'),
            'picture': f'evidence/{picture}',
            'source': row.get('intendedTree', data.get('intendedTree', data.get('sourceTree'))),
        })
    return result

before = read_capture('comparison-baseline', 'core') + read_capture('comparison-baseline', 'growth')
after = read_capture('final-comparison', 'core') + read_capture('final-comparison', 'growth')
populated_before = read_capture('comparison-baseline', 'growth', 'growth-populated-concept.json')
populated_after = read_capture('final-comparison', 'growth', 'growth-populated-concept.json')

def pick(rows, template):
    pattern = '^' + '/'.join('[^/]+' if part.startswith('[') else re.escape(part) for part in template.split('/')) + '$'
    found = [row for row in rows if re.match(pattern, row['path']) and row['width'] >= 1000 and row['theme'] == 'light' and ('[' not in template or row['path'] not in static)]
    if not found:
        raise ValueError(f'Missing matching desktop screenshot for {template}')
    return found[0]

verdicts = {}
for name in ['CORE', 'GROWTH']:
    for line in (ROOT / f'VISUAL-COMPARISON-{name}.md').read_text(encoding='utf-8-sig').splitlines():
        match = re.match(r'\|\s*`([^`]+)`', line)
        if match:
            value = line.split('|')[-2].strip()
            value = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', value)
            verdicts[match[1]] = value.replace('**', '').replace('`', '').replace('<br>', ' ')

cards, receipt = [], []
for index, template in enumerate(templates, 1):
    populated_role = template == '/competency/roles'
    baseline, current = (pick(populated_before, template), pick(populated_after, template)) if populated_role else (pick(before, template), pick(after, template))
    verdict = verdicts.get(template)
    if not verdict:
        raise ValueError(f'Missing independent route verdict: {template}')
    for item in [baseline, current]:
        if not (ROOT / item['picture']).is_file():
            raise FileNotFoundError(item['picture'])
    concept = 'evidence/concepts/competency-responsive-concept.png' if template.startswith('/competency') else 'evidence/concepts/dashboard-apple-concept.png'
    if populated_role:
        verdict += ' Gallery shows the matched populated role-library state; both stages use identical aggregate fixtures.'
    entry = {'template': template, 'before': baseline, 'concept': concept, 'final': current, 'verdict': verdict}
    receipt.append(entry)
    cards.append(f'''<section class="route" data-route="{escape(template)}">
      <h2><span>{index:02d}</span> {escape(template)}</h2><p class="verdict">{escape(verdict)} <a href="{concept}" target="_blank" rel="noopener">View shared design concept</a></p>
      <div class="pair"><figure><figcaption>Before · matched pre-redesign build</figcaption><a href="{escape(baseline['picture'])}" target="_blank" rel="noopener"><img loading="lazy" src="{escape(baseline['picture'])}" alt="Before: {escape(template)}"></a></figure>
      <figure><figcaption>Final · implemented application</figcaption><a href="{escape(current['picture'])}" target="_blank" rel="noopener"><img loading="lazy" src="{escape(current['picture'])}" alt="Final: {escape(template)}"></a></figure></div>
    </section>''')

final_trees = sorted({entry['final']['source'] for entry in receipt})
if len(final_trees) != 1:
    raise ValueError(f'Expected one final capture source tree, got {final_trees}')
document = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Performance Management · Visual comparison</title><style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1d1d1f;background:#f5f5f7}*{box-sizing:border-box}body{margin:0}header,main{max-width:1560px;margin:auto;padding:28px}h1{font-size:26px;letter-spacing:-.5px;margin:0 0 12px}p{max-width:100ch;line-height:1.6;color:#62636b}a{color:#0066cc}a:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #0066cc;outline-offset:3px}header{padding-bottom:8px}.controls{display:flex;align-items:center;gap:16px;flex-wrap:wrap}input{font:inherit;min-height:44px;padding:10px 12px;border:1px solid #858791;border-radius:6px;width:min(100%,420px)}label{font-weight:600}output{color:#62636b}.route{margin:0 0 32px;border-top:1px solid #dcdde3;padding-top:20px}h2{font-size:18px;margin:0;overflow-wrap:anywhere}h2 span{color:#62636b;font-size:14px;margin-right:10px}.verdict{font-size:14px;margin:10px 0 16px}.pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}figure{margin:0;min-width:0}figcaption{font-size:13px;font-weight:600;margin:0 0 8px}img{display:block;width:100%;height:auto;border:1px solid #dcdde3;background:white}details{margin:24px 0;padding:16px 0;border-top:1px solid #dcdde3;border-bottom:1px solid #dcdde3}summary{font-weight:600;cursor:pointer;padding:8px 0}.concepts{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:16px}[hidden]{display:none!important}@media(max-width:800px){header,main{padding:20px}.pair,.concepts{grid-template-columns:1fr}h1{font-size:23px}}
</style><header><h1>Performance Management: before, concept and final</h1>
<p>All 68 page templates, captured with matching synthetic data. Each route includes an independent visual verdict. Click a screenshot to inspect the original size. These are compiled local application screenshots; authenticated production proof is recorded separately.</p>
<p>Before source: a93ddbf9. Final application tree: [[FINAL_TREE]]. Exact identifiers and image paths are retained in the comparison manifest. <a href="VISUAL-COMPARISON-CORE.md">Core review</a> · <a href="VISUAL-COMPARISON-GROWTH.md">Growth review</a></p>
<details><summary>Desired design concepts and deliberate adaptations</summary><p>Generated proposals, not implementation screenshots. The final app retains real tasks, permissions and API fields. Responsive cards are kept where they remain readable; unsupported role-version metadata is not invented.</p><div class="concepts"><figure><figcaption>Dashboard direction</figcaption><a href="evidence/concepts/dashboard-apple-concept.png"><img loading="lazy" src="evidence/concepts/dashboard-apple-concept.png" alt="Generated dashboard concept"></a></figure><figure><figcaption>Competency direction</figcaption><a href="evidence/concepts/competency-responsive-concept.png"><img loading="lazy" src="evidence/concepts/competency-responsive-concept.png" alt="Generated competency concept"></a></figure></div></details>
<div class="controls"><label for="filter">Find a page</label><input id="filter" type="search" placeholder="For example, /team or competency"><output id="count" aria-live="polite">68 pages</output></div></header><main>''' + '\n'.join(cards) + '''</main><script>
const filter=document.querySelector('#filter'),routes=[...document.querySelectorAll('.route')],count=document.querySelector('#count');filter.addEventListener('input',()=>{const value=filter.value.trim().toLowerCase();let visible=0;for(const route of routes){route.hidden=!route.dataset.route.toLowerCase().includes(value);if(!route.hidden)visible++;}count.textContent=visible+' of 68 pages';});
</script></html>'''
document = document.replace('[[FINAL_TREE]]', escape(final_trees[0][:8]))
(ROOT / 'VISUAL-COMPARISON.html').write_text(document, encoding='utf-8')
(EVIDENCE / 'comparison-gallery-manifest.json').write_text(json.dumps({'routeCount': len(receipt), 'routes': receipt}, indent=2), encoding='utf-8')
print(f'Built {len(receipt)} matched page comparisons')
