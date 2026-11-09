import zipfile,copy
from xml.dom import minidom
from xml.dom import Node
z=zipfile.ZipFile('.ppt-build/base-v2.pptx');g=zipfile.ZipFile('.ppt-build/content-v2.pptx');d={n:z.read(n) for n in z.namelist()}
def parse(data):
 assert b'<!DOCTYPE' not in data and b'<!ENTITY' not in data
 return minidom.parseString(data)
def elements(n):return [x for x in n.childNodes if x.nodeType==Node.ELEMENT_NODE]
def texts(n):return ''.join(t.firstChild.data if t.firstChild else '' for t in n.getElementsByTagName('a:t'))
for target,source,title,label,page in [(18,1,'YAMNet 실환경 정확성 평가','E3',11),(19,2,'시중 홈캠과 HOME-TALK 비교','I2',4),(20,3,'시연 시나리오 예시','I3',5)]:
 path=f'ppt/slides/slide{target}.xml';r=parse(d[path]);tree=r.getElementsByTagName('p:spTree')[0]
 for x in list(elements(tree)):
  keep=x.tagName in ['p:nvGrpSpPr','p:grpSpPr']
  if x.tagName=='p:sp':
   text=texts(x);off=x.getElementsByTagName('a:off');y=int(off[0].getAttribute('y')) if off else 0
   keep=text in ['음성 이벤트 감지','8','E2'] or (not text and (y<2900000 or y>10000000))
  if x.tagName=='p:pic':
   off=x.getElementsByTagName('a:off');keep=bool(off) and int(off[0].getAttribute('y'))>10000000
  if not keep:tree.removeChild(x)
 for t in tree.getElementsByTagName('a:t'):
  if not t.firstChild:continue
  old=t.firstChild.data
  if old=='음성 이벤트 감지':t.firstChild.data=title
  elif old=='8':t.firstChild.data=str(page)
  elif old=='E2':t.firstChild.data=label
 new=parse(g.read(f'ppt/slides/slide{source}.xml')).getElementsByTagName('p:spTree')[0]
 for ch in elements(new)[2:]:tree.appendChild(r.importNode(ch,True))
 for i,x in enumerate(tree.getElementsByTagName('p:cNvPr'),1):x.setAttribute('id',str(i))
 d[path]=r.toxml(encoding='utf-8')
 # Copy the generated source citations and demo presenter notes.
 notes=f'ppt/notesSlides/notesSlide{target}.xml';d[notes]=g.read(f'ppt/notesSlides/notesSlide{source}.xml')
 relfile=f'ppt/slides/_rels/slide{target}.xml.rels';rr=parse(d[relfile]);node=rr.createElement('Relationship');node.setAttribute('Id','rIdNewNotes');node.setAttribute('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide');node.setAttribute('Target',f'../notesSlides/notesSlide{target}.xml');rr.documentElement.appendChild(node);d[relfile]=rr.toxml(encoding='utf-8')
 d[f'ppt/notesSlides/_rels/notesSlide{target}.xml.rels']=(f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSlide" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide{target}.xml"/></Relationships>').encode()
 ct=parse(d['[Content_Types].xml']);node=ct.createElement('Override');node.setAttribute('PartName','/'+notes);node.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml');ct.documentElement.appendChild(node);d['[Content_Types].xml']=ct.toxml(encoding='utf-8')
# Update only visible page markers and section numbers on original slides.
for i in range(4,18):
 f=f'ppt/slides/slide{i}.xml';r=parse(d[f]);num=i+2+(i>=9)
 for t in r.getElementsByTagName('a:t'):
  if not t.firstChild:continue
  old=t.firstChild.data
  if old==str(i):
   shape=t
   while shape and getattr(shape,'tagName','')!='p:sp':shape=shape.parentNode
   ph=shape.getElementsByTagName('p:ph') if shape else []
   off=shape.getElementsByTagName('a:off') if shape else []
   footer=any(x.getAttribute('type')=='sldNum' for x in ph) or (bool(off) and int(off[0].getAttribute('y'))>10000000)
   if footer:t.firstChild.data=str(num)
  elif i==4 and old=='I2':t.firstChild.data='I4'
  elif i==5 and old=='I3':t.firstChild.data='I5'
  elif i==9 and old=='E3':t.firstChild.data='E4'
 d[f]=r.toxml(encoding='utf-8')
with zipfile.ZipFile('.ppt-build/candidate-v2.pptx','w',zipfile.ZIP_DEFLATED) as out:
 for n,b in d.items():out.writestr(n,b)
print('20-slide draft: comparison 4, demo 5, evaluation 11')

