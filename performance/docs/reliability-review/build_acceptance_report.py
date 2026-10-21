"""Build the illustrated report from reviewed, synthetic screenshot sources.
Run with the bundled PDF Python runtime. This writes only report artifacts.
"""
from pathlib import Path
import json
import re
from html import escape
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.utils import ImageReader

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
OUT=ROOT/'output/pdf/Performance-full-role-acceptance-20261020.pdf'
DATA=json.loads((HERE/'ACCEPTANCE_REPORT_DATA.json').read_text(encoding='utf-8'))
PAGES=json.loads((HERE/'ACCEPTANCE_REPORT_PAGES.json').read_text(encoding='utf-8'))
TOTAL_PAGES=len(PAGES)+1
ACCEPTED=DATA.get('finalVerification',{}).get('passed') is True
FINALIZED=DATA.get('reportFinalized') is True
REPORT_COMPLETE=ACCEPTED or FINALIZED
REPORT_HEADER=('ACCEPTANCE VERIFIED / BOUNDED SCOPE' if ACCEPTED else 'VERIFIED WORK / OPEN EVIDENCE LIMITS' if FINALIZED else 'DRAFT - ACCEPTANCE IN PROGRESS')
FONT_DIR=Path('C:/Windows/Fonts')
pdfmetrics.registerFont(TTFont('UI',str(FONT_DIR/'segoeui.ttf')))
pdfmetrics.registerFont(TTFont('UIBold',str(FONT_DIR/'segoeuib.ttf')))
W,H=A4; M=38; CW=W-2*M
INK=colors.HexColor('#163039'); MUTED=colors.HexColor('#566870'); TEAL=colors.HexColor('#0C7974')
PALE=colors.HexColor('#E9F4F1'); AMBER=colors.HexColor('#945E12'); LINE=colors.HexColor('#D8E3E4')
OUT.parent.mkdir(parents=True,exist_ok=True)
c=canvas.Canvas(str(OUT),pagesize=A4,pageCompression=1)
c.setTitle('Performance Manager verification report'+('' if REPORT_COMPLETE else ' - DRAFT')+' - 20 October 2026')
c.setAuthor('Seemplify reliability review')
checks=[]

def clean(text):
    for a,b in [('â€“','-'),('â€”','-'),('â€™',"'"),('â‰¥','at least '),('â†’',' -> '),('â€¢',' / ')]:text=text.replace(a,b)
    return text

def para(text,x,y,width=CW,size=9.5,leading=13,bold=False,color=INK):
    style=ParagraphStyle('body',fontName='UIBold' if bold else 'UI',fontSize=size,leading=leading,textColor=color)
    item=Paragraph(escape(clean(str(text))),style); _,h=item.wrap(width,900)
    item.drawOn(c,x,y-h); return y-h

def chrome(number,title,tag):
    c.setFillColor(colors.white);c.rect(0,0,W,H,fill=1,stroke=0)
    c.setFillColor(TEAL);c.rect(0,H-8,W,8,fill=1,stroke=0)
    c.setFont('UIBold',9);c.setFillColor(INK);c.drawString(M,H-36,'SEEMPLIFY / PERFORMANCE MANAGER')
    c.setFont('UIBold',8);c.setFillColor(TEAL if REPORT_COMPLETE else AMBER);c.drawRightString(W-M,H-36,REPORT_HEADER)
    c.setStrokeColor(LINE);c.line(M,43,W-M,43)
    c.setFont('UI',7.5);c.setFillColor(MUTED);c.drawString(M,28,'20 OCT 2026 / Synthetic QA only / Snapshot '+DATA['snapshot'].split()[-2]+' UTC')
    c.drawRightString(W-M,28,f'{number:02d} / {TOTAL_PAGES:02d}')
    c.setFont('UIBold',34);c.setFillColor(TEAL);c.drawString(M,H-98,f'{number:02d}')
    bottom=para(title,M+61,H-67,CW-61,23,27,True)
    y=min(H-124,bottom-17)
    c.setFillColor(PALE if 'LOCAL' not in tag and 'PARTIAL' not in tag else colors.HexColor('#FBF1DF'))
    c.roundRect(M,y-4,CW,23,5,fill=1,stroke=0)
    para(tag,M+9,y+11,CW-18,8,10,True,TEAL if 'LOCAL' not in tag and 'PARTIAL' not in tag else AMBER)
    return y-21

def note(text,y=119):
    style=ParagraphStyle('note',fontName='UI',fontSize=8.3,leading=11.2,textColor=MUTED)
    item=Paragraph(escape(clean(text)),style);_,h=item.wrap(CW-20,400)
    c.setFillColor(colors.HexColor('#F3F6F6'));c.roundRect(M,y-h-11,CW,h+20,5,fill=1,stroke=0)
    item.drawOn(c,M+10,y-h)
    checks.append({'kind':'note','bottom':y-h-11})

for number,page in enumerate(PAGES,1):
    y=chrome(number,page['title'],page['tag'])
    for title,body in page['facts']:
        y=para(title,M,y,CW,10,13,True)-4
        y=para(body,M,y,CW,9.3,12.8)-11
    top=y-2
    image=ImageReader(str(HERE/'report-assets'/f"{page['image']}.png"));iw,ih=image.getSize()
    # Preserve complete screenshots; no UI reconstruction or selectively hidden fields.
    max_h=min(350,top-175)
    scale=min(CW/iw,max_h/ih);dw,dh=iw*scale,ih*scale;dx=M+(CW-dw)/2;dy=top-dh
    c.setFillColor(colors.HexColor('#EFF3F3'));c.roundRect(dx-2,dy-2,dw+4,dh+4,4,fill=1,stroke=0)
    c.drawImage(image,dx,dy,width=dw,height=dh,mask='auto')
    cap_bottom=para(page['caption'],M,dy-10,CW,7.7,10.2,False,MUTED)
    note(page['note'],min(117,cap_bottom-13))
    checks.append({'page':number,'imageBottom':dy,'captionBottom':cap_bottom})
    c.showPage()

# Last page is a readable transaction matrix, not a blanket feature pass grid.
y=chrome(TOTAL_PAGES,'Role coverage and evidence boundaries' if REPORT_COMPLETE else 'Role coverage and the remaining queue','PRODUCTION ROLE MATRIX' if REPORT_COMPLETE else 'FINAL MATRIX STILL OPEN')
y=para(DATA.get('matrixIntroduction','Every identity passed the independent live read/scope baseline. The table names completed browser transactions and unfinished handoffs; a pass in one row never certifies every feature for that role.'),M,y,CW,9,12.5)-12
style=ParagraphStyle('cell',fontName='UI',fontSize=7.8,leading=10.2,textColor=INK)
head=ParagraphStyle('head',fontName='UIBold',fontSize=8,leading=11,textColor=colors.white)
rows=[[Paragraph(x,head) for x in ['Role','Production transactions','Evidence boundary' if REPORT_COMPLETE else 'Still required']]]
for role,done,pending in DATA['roles']:
    rows.append([Paragraph(escape(clean(role)),style),Paragraph(escape(clean(done)),style),Paragraph(escape(clean(pending)),style)])
table=Table(rows,colWidths=[75,230,CW-305],hAlign='LEFT')
table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),TEAL),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#F2F6F6'),colors.white]),('LINEBELOW',(0,0),(-1,-1),0.4,LINE)]))
_,th=table.wrap(CW,900);table.drawOn(c,M,y-th);bottom=y-th
checks.append({'page':TOTAL_PAGES,'matrixBottom':bottom})
para(DATA.get('finalSummary',f"Full surface-by-surface evidence and remaining checks: PRODUCTION_COVERAGE_MATRIX.md. Final {DATA['preparedFinalContracts']} object assertions remain readiness-disabled. No cleanup has run."),M,bottom-12,CW,8,11,False,MUTED)
c.showPage();c.save()
assert all(item.get('bottom',100)>50 for item in checks),checks
assert bottom>100,checks
(ROOT/'tmp/pdfs').mkdir(parents=True,exist_ok=True)
(ROOT/'tmp/pdfs/acceptance-layout-checks.json').write_text(json.dumps(checks,indent=2)+'\n')
print(json.dumps({'draft':not REPORT_COMPLETE,'allFeatureAcceptance':ACCEPTED,'pages':TOTAL_PAGES,'pdf':str(OUT),'layoutChecks':len(checks)}))
