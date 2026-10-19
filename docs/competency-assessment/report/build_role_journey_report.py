"""Render the verified role-journey addendum from the public QA receipt."""
from pathlib import Path
import json
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[3]
DOCS = ROOT / 'docs/competency-assessment'
DATA = json.loads((DOCS / 'evidence/admin-manager-employee-acceptance.json').read_text(encoding='utf-8'))
OUT = ROOT / 'output/pdf/seemplify-role-journey-verification.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('Arial', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialBold', 'C:/Windows/Fonts/arialbd.ttf'))
W, H = A4
INK, MUTED, PAPER, LINE, ACCENT = [HexColor(x) for x in ['#20242C', '#5D6570', '#F4F1EA', '#D9D4CA', '#6747CC']]
c = canvas.Canvas(str(OUT), pagesize=A4)
c.setTitle('Seemplify - Admin, manager and employee verification')
c.setAuthor('Seemplify delivery team')

def text(x, y, value, size=11, bold=False, color=INK):
    c.setFillColor(color); c.setFont('ArialBold' if bold else 'Arial', size); c.drawString(x,y,str(value))

def para(value, x, top, width, size=10, color=INK):
    p=Paragraph(value, ParagraphStyle('body',fontName='Arial',fontSize=size,leading=size*1.42,textColor=color))
    _, height=p.wrap(width, 1000); p.drawOn(c,x,top-height); return height

def base(number, label):
    c.setFillColor(PAPER); c.rect(0,0,W,H,fill=1,stroke=0)
    text(36,H-36,'SEEMPLIFY / PERFORMANCE',9,True,ACCENT)
    text(36,H-61,label,23,True)
    c.setStrokeColor(LINE);c.line(36,58,W-36,58)
    text(36,40,'19 OCT 2026  |  SYNTHETIC LOCAL ACCEPTANCE',8,color=MUTED)
    text(W-61,40,f'{number} / 3',8,color=MUTED)

def box(x,y,w,h,fill='#FFFFFF'):
    c.setFillColor(HexColor(fill));c.setStrokeColor(LINE);c.roundRect(x,y,w,h,8,fill=1,stroke=1)

def image_top(file, x, y, width, height):
    img=ImageReader(str(file));iw,ih=img.getSize();scaled=width*ih/iw
    c.saveState();p=c.beginPath();p.rect(x,y,width,height);c.clipPath(p,stroke=0)
    c.drawImage(img,x,y+height-scaled,width=width,height=scaled);c.restoreState()
    c.setStrokeColor(LINE);c.rect(x,y,width,height,fill=0,stroke=1)

base(1,'01  The complete role handoff')
para('Three separate sign-ins. Real forms, permissions and persisted outcomes.<br/>The earlier owner-only walkthrough has been supplemented with this multi-role proof.',36,H-79,W-72,11,MUTED)
for i,(role,action) in enumerate([('ADMIN','Configure and select reviewer'),('MANAGER','Review evidence and decide'),('EMPLOYEE','Submit, read and acknowledge')]):
    x=36+i*178;box(x,650,166,58)
    text(x+12,687,role,10,True,ACCENT);para(action,x+12,675,142,9)
    if i<2:c.setStrokeColor(ACCENT);c.line(x+167,679,x+177,679)
for i,(value,label) in enumerate([(DATA['backend']['integration'],'INTEGRATION TESTS'),(DATA['http']['requests'],'HTTP REQUESTS'),(64,'TARGETED BROWSER CASES'),(5,'REAL LOCAL IDP ACCOUNTS')]):
    x=36+i*133;box(x,565,124,66,'#E9E4F5');text(x+12,598,value,24,True);text(x+12,579,label,6.7,True,MUTED)
text(36,540,'Five fixes found by following the journey',13,True)
fixes=[('Selected reviewer privacy','Unselected team managers can no longer open or change private linked assessments.'),('Explicit employee PDF access','A central export grant now works for the employee\'s own report only; defaults are unchanged.'),('Employee report discovery','Direct report links, retained previous reports and a clear evidence/role view replace empty assessor forms.'),('Accessible review questions','Question names, required text state and label-to-control focus now work in the review forms.'),('Goal-required launch readiness','Missing approved goals are rejected before a review or its notification events are created.')]
for i,(title,body) in enumerate(fixes):
    y=464-i*65;box(36,y,W-72,57)
    text(48,y+34,f'{i+1:02}',12,True,ACCENT);text(80,y+35,title,11,True);para(body,80,y+25,W-132,9)
para('Also passed: 83 legacy and 38 unit tests. The final accessibility change re-ran two existing browser cases; those executions are not added to the distinct-case total. Production revision and external-provider acceptance are separate evidence layers.',36,120,W-72,9,MUTED)
c.showPage()

base(2,'02  What the employee receives')
para('Actual local Seemplify sign-in, using a synthetic employee. The report preserves the selected reviewer, submitted feedback, native role expectations and human outcome.',36,H-79,W-72,11,MUTED)
for i,(title,body) in enumerate([('80 / 100','Human final classification: Suitable'),('7 + 2 REQUIRED ANSWERS','Employee and reviewer forms submitted'),('ONE FINAL HISTORY','Acknowledgement leaves report hash intact')]):
    x=36+i*178;box(x,663,166,59);text(x+11,700,title,10,True,ACCENT);para(body,x+11,688,144,9)
image_top(DOCS/'evidence/qa-local-employee-report.png',36,170,W-72,485)
para('Top of the actual synthetic local report. The complete screenshot is linked from the Markdown QA report. Employee scope excludes private assessor evidence and drafts; default employees do not receive a PDF export button. A separate explicit grant is tested with own-only export and revocation.',36,148,W-72,10,MUTED)
c.showPage()

base(3,'03  Prevent a blocked review')
para('<b>Before:</b> an appraisal could start without approved goals and strand the employee at submission.<br/><b>Now:</b> a goal-required cycle stops that participant at launch, before creating the appraisal or its events. The administrator gets a recovery message.',36,H-79,W-72,11)
image_top(DOCS/'evidence/qa-local-goal-launch-blocked.png',36,232,W-72,445)
text(36,208,'Verified before and after the fix',13,True)
para('1. No goals, draft goals and pending approval: no appraisal or event is created.<br/>2. Approved and aligned goal: a successful launch retains the goal snapshot.<br/>3. Mixed batch: eligible people start; blocked people get their own error.<br/>4. Retry: successful reviews are reused without duplicate events.',36,190,W-72,11)
para('Tests use the actual goal draft, submit and approval APIs. The separate manual happy path explicitly uses a goal-optional synthetic cycle and still completes every required employee and reviewer question. No production goal policy was disabled for QA.',36,102,W-72,8.5,MUTED)
c.save()
print(str(OUT))
