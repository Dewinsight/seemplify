from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
import json, math
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'output/pdf/seemplify-competency-delivery-report.pdf'
META=Path(__file__).with_name('report-status.json')
meta=json.loads(META.read_text(encoding='utf-8')) if META.exists() else {}
for name,file in [('Body','arial.ttf'),('Bold','arialbd.ttf'),('Italic','ariali.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(Path('C:/Windows/Fonts')/file)))
W,H=595.276,841.89; M=42; CW=W-2*M
INK=colors.HexColor('#201D28'); MUTED=colors.HexColor('#696470'); PAPER=colors.HexColor('#FAF8F3'); LINE=colors.HexColor('#DED9E3'); ACCENT=colors.HexColor('#7048E8'); SOFT=colors.HexColor('#EEE8FC'); TEAL=colors.HexColor('#187D6A'); WHITE=colors.white
c=canvas.Canvas(str(OUT),pagesize=(W,H));c.setTitle('Seemplify competency assessment - delivery report');c.setAuthor('Seemplify delivery team')
styles={k:ParagraphStyle(k,fontName=f,fontSize=z,leading=z*1.4,textColor=col,spaceAfter=0) for k,f,z,col in [('body','Body',10,INK),('small','Body',8.2,MUTED),('label','Bold',8.5,ACCENT),('title','Bold',25,INK),('h2','Bold',15,INK),('cell','Body',8.8,INK),('white','Body',11,WHITE)]}
def para(text,x,y,width=CW,kind='body'):
    p=Paragraph(text,styles[kind]);_,height=p.wrap(width,H);p.drawOn(c,x,y-height);return y-height

def rect(x,y,w,h,fill=PAPER,r=10,stroke=None):
    c.setFillColor(fill);c.setStrokeColor(stroke or fill);c.roundRect(x,y,w,h,r,stroke=bool(stroke),fill=1)
def line(x1,y1,x2,y2,col=LINE):
    c.setStrokeColor(col);c.setLineWidth(.7);c.line(x1,y1,x2,y2)
def header(n,title,subtitle):
    c.setFillColor(PAPER);c.rect(0,0,W,H,stroke=0,fill=1)
    para('SEEMPLIFY / PERFORMANCE',M,H-28,kind='label');para(f'{n:02d}',W-M-24,H-28,30,'label')
    y=para(title,M,H-70,kind='title');para(subtitle,M,y-13,kind='small');line(M, H-148,W-M,H-148)
    c.setFillColor(MUTED);c.setFont('Body',7.5);c.drawString(M,25,'19 OCT 2026  |  '+meta.get('releaseLabel','LOCAL IMPLEMENTATION - RELEASE PENDING'));c.drawRightString(W-M,25,f'{n} / 8')
def end():c.showPage()
def badge(text,x,y,w=120):
    rect(x,y,w,23,SOFT,6);para(text,x+9,y+17,w-18,'label')
def image_panel(path,x,y,w,h,offset=0):
    path=Path(path)
    if not path.is_file():
        rect(x,y,w,h,SOFT);para('Current capture pending',x+15,y+h-18,w-30,'small');return
    img=ImageReader(str(path));iw,ih=img.getSize();scale=w/iw
    c.saveState();p=c.beginPath();p.roundRect(x,y,w,h,8);c.clipPath(p,stroke=0);c.drawImage(img,x,y+h+offset-ih*scale,w,ih*scale,mask='auto');c.restoreState()
    c.setStrokeColor(LINE);c.roundRect(x,y,w,h,8,stroke=1,fill=0)
def table(rows,y,widths):
    cells=[[Paragraph(str(v),styles['cell']) for v in row] for row in rows]
    t=Table(cells,colWidths=widths,hAlign='LEFT');t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),SOFT),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('LINEBELOW',(0,0),(-1,-1),.5,LINE)]));_,hh=t.wrap(CW,H);t.drawOn(c,M,y-hh);return y-hh
features=[
('CA-001','Create or upload a role','Manual authoring; reviewed TXT/PDF/DOCX extraction; safe source download.','Local QA'),
('CA-002','Version and archive roles','Published definitions remain immutable; conflicting edits preserve the draft.','Local QA'),
('CA-003','Frameworks and native levels','Internal and supplied SFIA definitions retain their own descriptors and provenance.','Local QA'),
('CA-004','Seven source combinations','Choose SFIA, internal, strategy, or any non-empty combination.','API / PDF'),
('CA-005','Strategy criteria','Author outcomes or capture an authorised existing objective and its version.','Local QA'),
('CA-006','Role expectations','Map responsibilities and requirements to native levels or named numeric targets.','Local QA'),
('CA-007','People, roles and reviewers','Select roles in existing appraisal setup; recover partial links without duplicate appraisals.','UI / API'),
('CA-008','Expected versus observed','Use the same frozen role in findings, score breakdown and report.','UI / API'),
('CA-009','Role-aware AI assistance','Personal connected account; cited observations remain a human-reviewed draft.','Provider gate'),
('CA-101','Evidence intake and access','Private, criterion-linked sources; manual notes remain available without integrations.','UI / API'),
('CA-102','Structured oral assessment','Questions, answers, notes, date, time zone, participants and submission history.','UI / API'),
('CA-103','Calendar and in-app calls','Reuse call scheduling; link permitted transcripts after source and assessment consent.','Provider gate'),
('CA-104','Review AI drafts','Accept, edit or dismiss cited suggestions; AI cannot choose the final rating.','Provider gate'),
('CA-105','Assessor workspace','Save and resume findings; compare concurrent edits instead of silently overwriting.','UI / API'),
('CA-106','Explainable scoring','Explicit conversions, weights, coverage, thresholds and decimal rounding.','API / PDF'),
('CA-107','Human final classification','Suggestion and decision stay separate; direct publication needs no second approval.','UI / API'),
('CA-108','Comparable rankings','Configured scope, tie rule and precision; incompatible definitions stay separate.','API / PDF'),
('CA-109','Separate permissions','Current identity and team scope; viewing, editing, exporting and finalising are distinct.','IdP / API'),
('CA-110','Completion and exceptions','Missing evidence is distinct from a low score; authorised exceptions retain their reason.','UI / API'),
('CA-111','Complete manager feedback','Freeze overall, competency, goal and custom answers with actual author and dates.','UI / PDF'),
('CA-112','Participant report and PDF','Role definitions, findings, oral notes, feedback, score and immutable report version.','UI / PDF'),
('CA-113','Cohort reporting','Scoped completion, gaps, filters and comparable rankings, with private PDF export.','UI / PDF'),
('CA-114','History and reopening','Retain earlier final results; publish later revisions without rewriting history.','UI / API'),
('CA-115','Consent and retention','Separate purposes, source withdrawal, legal holds, deletion retries and bounded exports.','API / QA'),
('CA-116','Pilot and release proof','Ten-person synthetic pilot plus layered browser, API, provider and deployment evidence.','Release gate')]
header(1,'Competency assessment\nDelivery report','What was implemented, how it was checked, and what is actually live.')
rect(M,H-341,CW,164,INK,14);para(meta.get('headline','Implementation complete in core areas. Final acceptance is in progress.'),M+22,H-200,CW-44,'white');para('No automatic employment decisions. AI and recorded calls are optional. Historical role definitions and final reports are preserved.',M+22,H-274,CW-44,'white')
y=H-380;para('A full team, delivered as a rolling pipeline',M,y,kind='h2');y-=40
stages=[('Product','25 stories'),('Architecture','API + security'),('UX','2 screen specs'),('Build','2 pairs'),('QA','Independent')]
for i,(name,sub) in enumerate(stages):
    x=M+i*(CW/5);rect(x,y-58,CW/5-7,58,WHITE,8,LINE);para(name,x+8,y-10,CW/5-23,'label');para(sub,x+8,y-29,CW/5-23,'small')
y-=91;para('Four concurrent slots were available, including the coordinator. The requested six-worker ceiling was respected by rotating specialists and retaining product and architecture reviewers.',M,y,kind='body')
for i,(num,label) in enumerate([('25','stories mapped'),('7','source combinations'),('10','synthetic pilot people')]):
    x=M+i*(CW/3);para(num,x,y-85,CW/3,'title');para(label,x,y-121,CW/3,'small')
para('Evidence distinction',M,155,kind='label');para('Local implementation, fixture-based tests, an authenticated local walkthrough, real scanner checks and live deployment are recorded separately. A concept image is never treated as a shipped screen.',M,135,kind='small');end()
for page,title,sub,group in [(2,'1-9  Define and launch','Reusable definitions feed the existing appraisal setup.',features[:9]),(3,'10-18  Assess and decide','Evidence supports human judgement; calculation stays explainable.',features[9:18]),(4,'19-25  Publish and operate','Reports preserve meaning, authorship and the version actually used.',features[18:])]:
    header(page,title,sub);rows=[['Story','Capability','Implemented behaviour','Proof']]+[[a,b,d,e] for a,b,d,e in group];bottom=table(rows,H-169,[53,116,263,CW-432]);para('Proof labels describe current local evidence. Provider and release gates remain explicit until their actual artifacts and deployment have been verified.',M,bottom-20,kind='small');end()
header(5,'The interface, made concrete','Actual local screens and labelled design references.')
image_panel(ROOT/'docs/competency-assessment/evidence/screenshots/local-authenticated-linked-launch.jpg',M,430,CW,230);para('Linked launch - fresh local IdP session, actual API/Mongo, synthetic participant.',M,417,kind='small')
image_panel(ROOT/'docs/competency-assessment/evidence/screenshots/local-authenticated-role-comparison.jpg',M,136,CW,248,20);para('Published role comparison - authenticated local app, actual saved synthetic result.',M,123,kind='small');para('The new role selection is inside Start appraisal. Library/workbench pages are additional workspaces, not a replacement for the existing employee and reviewer journey.',M,88,kind='small');end()
header(6,'From evidence to a decision','A verified manual route works without AI or recorded calls.')
y=655
steps=[('1','Frozen role','Expected Independent level, with the original native definition.'),('2','Retained evidence','Manual delivery record plus a submitted structured oral assessment.'),('3','Human finding','Observed Independent, supporting sources and a written rationale.'),('4','Transparent calculation','Configured conversion gives 80 / 100. Coverage: one of one criteria.'),('5','Human finalisation','The assessor chooses Suitable; the report is published directly.')]
for number,title,body in steps:
    rect(M,y-77,CW,77,WHITE,10,LINE);rect(M+12,y-52,30,30,SOFT,8);para(number,M+23,y-32,20,'label');para(title,M+55,y-13,CW-72,'h2');para(body,M+55,y-39,CW-72,'small');y-=93
para('Feedback has its own provenance',M,171,kind='label');para('Overall comments, individual goal comments and custom reviewer answers retain their submitted author and timestamp. Oral notes and AI observations are labelled separately.',M,150,kind='body');para('This worked in the authenticated local application. It does not claim a real employee decision or a newly completed external recording.',M,85,kind='small');end()
header(7,'Permissions and recovery','Controls follow the current person, organisation, action and source.')
y=table([['Actor','Normal scope','Key boundary'],['Employee','Personal','Own permitted evidence and final results; assessor drafts remain private.'],['Team lead / line manager','Current managed hierarchy','Role assignment alone cannot retain authority after a team or role change.'],['Owner / admin / HR','Organisation, subject to grants','View, export, exceptions, finalise and reopen are separate actions.'] ],H-169,[117,150,CW-267])
y-=29;para('Two consent boundaries',M,y,kind='h2');y-=37
for i,(title,body) in enumerate([('Recording + transcription','Both actual call participants agree before a new calendar notetaker is scheduled.'),('Assessment + AI use','Source reuse and optional personal AI processing each require their applicable notice and permission.')]):
    x=M+i*(CW/2+7);rect(x,y-112,CW/2-7,112,WHITE,10,LINE);para(title,x+12,y-13,CW/2-31,'label');para(body,x+12,y-39,CW/2-31,'body')
para('Recovery that protects work',M,235,kind='h2');para('Conflicting edits can be compared and backed up with actual draft values. Interrupted role links reuse the saved appraisal. Source expiry blocks processing before cleanup; failed deletions retain a retryable tombstone. Publication uses a transaction fence for linked outcomes.',M,207,kind='body');para('Upload budgets: four active uploads, two scans and two parsers per application process, plus a per-user upload rate limit. Private source bytes are not exposed as public links.',M,103,kind='small');end()
header(8,'Test and release evidence','Passing tests and live operation are separate proof layers.')
rows=[['Layer','Current result','Evidence boundary'],['Domain / API',meta.get('mongo','Final rerun pending'),'Disposable Mongo, real services and persistence; test authority fixtures.'],['Scoring / files / budgets',meta.get('pure','25 targeted checks passed'),'Deterministic arithmetic, parser/scanner protocol and workload limits.'],['Identity',meta.get('idp','35 focused checks passed'),'Catalog, current team scope and migration concurrency.'],['Browser',meta.get('browser','Final consent/report run pending'),'UI contracts plus a real API/Mongo report/PDF journey.'],['Authenticated local app','Fresh sign-in + linked launch','Actual localhost5005 to API5004; synthetic people, role and saved report.'],['Actual scanner','TXT / PDF / DOCX accepted','Private ClamAV helper check; safe antivirus pattern rejected.'],['Live optional providers',meta.get('providers','Acceptance pending'),'Mocks do not prove live personal inference or new call artifacts.'],['Production release',meta.get('release','Not yet deployed'),'Requires exact reviewed commit, CI, deployment and live smoke.']]
y=table(rows,H-169,[115,142,CW-257]);y-=27
para('Release identity',M,y,kind='label');y=para(meta.get('revision','Source baseline b401f1b1 plus uncommitted programme files. Unrelated lifecycle work is excluded from this release.'),M,y-20,kind='small')
para('Research and source documents',M,y-23,kind='label');para('Full Markdown plan, stories, architecture, UX specifications, role skills, review findings and evidence: docs/competency-assessment/. Research: GOV.UK Service Manual; C4 model; W3C WCAG 2.2; OWASP ASVS; Playwright official testing guidance.',M,y-44,kind='small');end()
c.save();print(OUT)
