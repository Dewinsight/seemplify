"""Render the reviewed delivery receipt and real screenshots into a visual PDF."""
import json
import sys
from pathlib import Path
from datetime import datetime
from html import escape
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color, white
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / 'evidence/report-data.json').read_text(encoding='utf-8'))
if '--final' in sys.argv:
    if DATA.get('comparisonComplete') is not True:
        raise ValueError('The all-page before/concept/final visual comparison has not been approved.')
    if DATA['release'].get('verified') is not True:
        raise ValueError('Live release verification has not been recorded.')
    delivery = json.dumps(DATA).lower()
    if any(word in delivery for word in ['pending', 'preliminary', 'capture unavailable']):
        raise ValueError('Final delivery receipt still contains unresolved status placeholders.')
    if any(item['result'] != 'PASS' for item in DATA['checks']):
        raise ValueError('Final quality gate is not passing.')
    for relative in DATA['images'].values():
        if not (ROOT / relative).is_file():
            raise FileNotFoundError(relative)
OUT = ROOT / 'Performance-Management-Design-Delivery.pdf'
W, H = 595.28, 841.89
PAGE_COUNT = 9
INK, MUTED, BLUE, LINE, PALE = map(HexColor, ['#1d1d1f','#62636b','#0066cc','#dcdde3','#f5f5f7'])
FONTROOT = Path('C:/Windows/Fonts')
pdfmetrics.registerFont(TTFont('UI', str(FONTROOT / 'segoeui.ttf')))
pdfmetrics.registerFont(TTFont('UI-Bold', str(FONTROOT / 'seguisb.ttf')))
c = canvas.Canvas(str(OUT), pagesize=(W,H))
c.setTitle('Performance Management | Design delivery')
c.setAuthor('Seemplify delivery team')
c.setSubject('Numbered implementation, visual evidence, verification and release receipt')

def text(value, x, y, size=11, color=INK, bold=False):
    c.setFillColor(color); c.setFont('UI-Bold' if bold else 'UI', size); c.drawString(x,y,str(value))

def para(value, x, top, width=507, size=11, color=INK, leading=None):
    p=Paragraph(escape(str(value)), ParagraphStyle('body',fontName='UI',fontSize=size,leading=leading or size*1.5,textColor=color,spaceAfter=0))
    _,height=p.wrap(width,1000)
    if top-height < 54:
        raise ValueError(f'Text crosses footer on page {c.getPageNumber()}: {str(value)[:70]}')
    p.drawOn(c,x,top-height); return top-height

def page(number,title,kicker):
    c.setFillColor(white); c.rect(0,0,W,H,fill=1,stroke=0)
    text('SEEMPLIFY  /  PERFORMANCE MANAGEMENT',44,H-40,9,MUTED,True)
    text(f'{number:02d}',44,H-95,32,BLUE,True)
    text(title,103,H-91,23,INK,True)
    para(kicker,44,H-120,size=11,color=MUTED)
    c.setStrokeColor(LINE); c.line(44,H-148,W-44,H-148)

def footer(number):
    c.setStrokeColor(LINE); c.line(44,42,W-44,42)
    text('21 October 2026  |  Evidence-backed delivery',44,26,8,MUTED)
    text(f'{number} / {PAGE_COUNT}',W-75,26,8,MUTED)
    c.showPage()

def image_box(relative,x,top,width,height,caption):
    file=ROOT/relative
    c.setFillColor(PALE); c.roundRect(x,top-height,width,height,8,fill=1,stroke=0)
    if file.exists():
        image=ImageReader(str(file)); iw,ih=image.getSize()
        scale=min((width-2)/iw,(height-2)/ih)
        dw,dh=iw*scale,ih*scale
        c.drawImage(image,x+(width-dw)/2,top-height+(height-dh)/2,dw,dh,mask='auto')
    else:
        para('Capture unavailable - see evidence ledger.',x+12,top-20,width-24,10,MUTED)
    para(caption,x,top-height-8,width,9,MUTED,12)

def bullets(items,top):
    for index,item in enumerate(items):
        c.setFillColor(BLUE); c.circle(48,top-6,2,fill=1,stroke=0)
        top=para(item,60,top,491,11)-13
    return top

page(1,'What changed','A consistent Apple-inspired design across the existing Performance Management application.')
top=H-178
top=para(DATA['outcome'],44,top,size=15,leading=22)-22
for x,number,label in [(44,str(DATA['routeCount']),'existing route templates'),(218,'12','reviewed story packages'),(392,'5','reusable team role skills')]:
    c.setFillColor(PALE);c.roundRect(x,top-75,159,75,8,fill=1,stroke=0)
    text(number,x+16,top-34,26,BLUE,True);text(label,x+16,top-56,8.5,MUTED)
top-=110
top=bullets(DATA['delivered'],top)
text('Delivery pipeline',44,top-18,13,INK,True)
stages=['Stories','Architecture','Design','Paired build','QA + release']
for i,label in enumerate(stages):
    x=44+i*103
    c.setFillColor(HexColor('#eaf3ff'));c.roundRect(x,top-74,95,34,6,fill=1,stroke=0)
    text(label,x+8,top-60,8.5,BLUE,True)
    if i<4:text('>',x+97,top-60,9,MUTED)
para('Four concurrent Codex agents rotated roles within the six-worker ceiling. Two product analysts handed off work incrementally; two implementation lanes used separate file ownership and retained product/architecture reviewers.',44,top-104,size=10,color=MUTED)
footer(1)

page(2,'Dashboard: before and after','The work takes priority: quieter help, a shorter header, readable metrics and balanced task destinations.')
image_box(DATA['images']['dashboardBefore'],44,H-171,507,262,'BEFORE - actual local application with controlled synthetic data.')
image_box(DATA['images']['dashboardAfter'],44,H-471,507,262,DATA['captions'].get('dashboardAfter','AFTER - actual compiled implementation with matching synthetic data.'))
footer(2)

page(3,'Concept and final choices','The proposed image is a reference; the final UI is reviewed against real tasks.')
image_box('evidence/concepts/dashboard-apple-concept.png',44,H-171,507,300,'DESIRED CONCEPT - generated proposal, not a product screenshot.')
top=H-505
top=bullets(DATA.get('comparisonFindings',[
    'System typography, neutral grouped surfaces and consistent blue actions carry the concept into the existing app.',
    'Help stays secondary. Existing tasks and role-specific actions retain priority; unsupported concept metadata is not invented.',
    'Matched before/final captures and per-route reviews test readability, hierarchy, density, controls and remaining differences.'
]),top)
para('Every route has an explicit comparison verdict. A populated after screen is never treated as a design improvement over an unrelated authentication or recovery state. The comparison documents retain the actual images and source revisions.',44,top-10,size=10,color=MUTED)
footer(3)

page(4,'Core performance workflows','Goals, appraisals, reviews, cycle administration, people and analytics share the same visual rules.')
image_box(DATA['images']['coreOne'],44,H-171,507,240,DATA['captions']['coreOne'])
if DATA['images'].get('peopleBefore') and DATA['images'].get('peopleAfter'):
    image_box(DATA['images']['peopleBefore'],44,H-448,244,240,'BEFORE - actual mobile member card.')
    image_box(DATA['images']['peopleAfter'],307,H-448,244,240,'FINAL - readable identity, metrics and actions.')
else:
    image_box(DATA['images']['coreTwo'],44,H-448,507,240,DATA['captions']['coreTwo'])
para('Implemented: consistent headings and fields, readable people cards, clear status and task actions. Existing drafts, submissions, finalization and print contracts stay intact.',44,108,size=10,color=MUTED)
footer(4)

page(5,'Growth and competency','Growth, talent, competency and AI screens share the same design system.')
image_box(DATA['images']['growthOne'],44,H-171,507,240,DATA['captions']['growthOne'])
image_box(DATA['images']['growthTwo'],44,H-448,507,240,DATA['captions']['growthTwo'])
para('Preserved: audience and anonymity rules, recording consent, optional AI, human assessment outcomes, versioned definitions and role-based access. Provider execution is a separate verification layer.',44,108,size=10,color=MUTED)
footer(5)

page(6,'Mobile, dark mode and access','The design adapts to the device and user preferences without changing the task.')
image_box(DATA['images']['mobile'],44,H-171,196,425,DATA['captions'].get('mobile','Actual mobile layout, synthetic data.'))
image_box(DATA['images']['dark'],256,H-171,295,220,DATA['captions'].get('dark','Actual dark-mode application, synthetic data.'))
top=H-431
for item in DATA['accessibility']:
    top=para('• '+item,256,top,295,10)-12
para('Keyboard menus, focus restoration, mobile resize recovery, theme persistence, press cancellation, reduced motion and solid-material fallbacks are verified by behavior checks. Automated checks are not a blanket accessibility certification.',44,180,size=10,color=MUTED)
footer(6)

page(7,'Evidence and quality gates','Exact checks and their results; no pass is inferred from a screenshot or a healthy process.')
top=H-176
for item in DATA['checks']:
    text(item['result'],44,top-2,10,BLUE if item['result'].lower() in ['pass','passed'] else MUTED,True)
    top=para(item['name'],105,top+9,446,11)-2
    top=para(item['detail'],105,top,446,9,MUTED)-18
text('Coverage boundary',44,top-6,13,INK,True)
para(DATA['coverageBoundary'],44,top-25,size=10,color=MUTED)
footer(7)

page(8,'Release and exact outcome','Source, test, CI, deployed revision and authenticated browser proof remain separate records.')
top=H-176
for key,label in [('testedRevision','Tested revision'),('publishedRevision','Published main revision'),('liveRevision','Verified live revision'),('deployment','Deployment'),('identity','Identity and role smoke'),('protection','Repository protection')]:
    text(label,44,top,10,MUTED,True)
    if key == 'deployment' and DATA['release'].get('deploymentUrl'):
        text('View release run',455,top,9,BLUE)
        c.linkURL(DATA['release']['deploymentUrl'],(455,top-2,551,top+11),relative=0)
    top=para(str(DATA['release'].get(key,'Not established')),44,top-11,size=11)-24
text('Remaining limits',44,top,13,INK,True)
bullets(DATA['limits'],top-22)
footer(8)

page(9,'Handover and design provenance','Organized documents and evidence help the next team continue consistently.')
top=H-177
for title,detail in DATA['handover']:
    text(title,44,top,12,INK,True);top=para(detail,44,top-12,size=10,color=MUTED)-22
text('Reference concept - not an implementation screenshot',44,top,11,BLUE,True)
image_box('evidence/concepts/competency-responsive-concept.png',44,top-17,507,220,'Generated UX proposal. Actual application screenshots appear on pages 2, 4, 5 and 6.')
top-=275
para('Design reference: github.com/emilkowalski/skills, apple-design/SKILL.md. Research: Scrum Guide; C4 model; W3C WCAG 2.2; Playwright; official Codex subagent and skill documentation. Exact source links and decisions are in research-product.md and research-design-qa.md.',44,top,size=9,color=MUTED)
footer(9)
c.save()
print(OUT)
