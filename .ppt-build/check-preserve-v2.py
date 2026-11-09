import zipfile
from xml.dom import minidom
z=zipfile.ZipFile('최종 데모용.pptx');f=zipfile.ZipFile('.ppt-build/candidate-v2.pptx')
for i in range(1,18):
 a=minidom.parseString(z.read(f'ppt/slides/slide{i}.xml'));b=minidom.parseString(f.read(f'ppt/slides/slide{i}.xml'))
 aa=a.getElementsByTagName('a:t');bb=b.getElementsByTagName('a:t');assert len(aa)==len(bb)
 for x,y in zip(aa,bb):
  old=x.firstChild.data if x.firstChild else '';new=y.firstChild.data if y.firstChild else ''
  if old==new:continue
  shape=x
  while shape and getattr(shape,'tagName','')!='p:sp':shape=shape.parentNode
  ph=shape.getElementsByTagName('p:ph') if shape else [];off=shape.getElementsByTagName('a:off') if shape else []
  footer=any(p.getAttribute('type')=='sldNum' for p in ph) or (bool(off) and int(off[0].getAttribute('y'))>10000000)
  assert footer or (i,old,new) in [(4,'I2','I4'),(5,'I3','I5'),(9,'E3','E4')],(i,old,new)
for n in z.namelist():
 if n.startswith(('ppt/media/','ppt/slideMasters/','ppt/slideLayouts/','ppt/theme/')):assert z.read(n)==f.read(n),n
print('Original content verified: only page and section markers changed; all source media, masters, layouts and themes preserved.')
