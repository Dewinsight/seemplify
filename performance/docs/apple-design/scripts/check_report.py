"""Check final report content and retain its exact artifact identity.

Visual page inspection remains a separate mandatory review.
"""
import hashlib
import json
from pathlib import Path
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
data = json.loads((root / 'evidence/report-data.json').read_text(encoding='utf-8'))
if not data['release']['verified'] or not data['comparisonComplete']:
    raise ValueError('Final release and comparison gates must be recorded first.')
path = root / 'Performance-Management-Design-Delivery.pdf'
reader = PdfReader(path)
if len(reader.pages) != 9:
    raise ValueError('Expected nine numbered report pages.')
text = ' '.join(' '.join(page.extract_text().split()) for page in reader.pages)
for forbidden in ['pending', 'preliminary', 'capture unavailable']:
    if forbidden in text.lower():
        raise ValueError(f'Unresolved report placeholder: {forbidden}')
for required in ['68', '7eb9c096', '8ce5e4b4', '39524124932', '19 passed initially', 'three unchanged replays']:
    if required not in text:
        raise ValueError(f'Missing verified receipt detail: {required}')
links = []
for page in reader.pages:
    for annotation in page.get('/Annots', []):
        action = annotation.get_object().get('/A', {})
        if action.get('/URI'):
            links.append(str(action['/URI']))
if data['release']['deploymentUrl'] not in links:
    raise ValueError('Final deployment run link is missing.')
receipt = {
    'file': path.name,
    'pages': len(reader.pages),
    'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    'bytes': path.stat().st_size,
    'requiredDetailsPresent': True,
    'unresolvedPlaceholders': [],
    'deploymentLinkPresent': True,
    'visualInspection': 'Recorded separately after rendering all nine pages.'
}
(root / 'evidence/report-check.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps(receipt, indent=2))
