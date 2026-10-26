import zipfile,xml.etree.ElementTree as E,copy,re
from pathlib import Path
ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
for k,v in ns.items():E.register_namespace(k,v)
z=zipfile.ZipFile('최종 데모용.pptx');g=zipfile.ZipFile('.ppt-build/content.pptx');d={n:z.read(n) for n in z.namelist()}
r=E.fromstring(d['ppt/slides/slide8.xml']);tree=r.find('p:cSld/p:spTree',ns)
keep=list(tree)[:2]+[x for x in tree.findall('p:sp',ns) if ''.join(t.text or '' for t in x.findall('.//a:t',ns)) in ['음성 이벤트 감지','8','E2'] or (not x.findall('.//a:t',ns) and (x.find('p:spPr/a:xfrm/a:off',ns) is None or int(x.find('p:spPr/a:xfrm/a:off',ns).get('y','0'))<2900000 or int(x.find('p:spPr/a:xfrm/a:off',ns).get('y','0'))>10000000))]+[x for x in tree.findall('p:pic',ns) if int(x.find('p:spPr/a:xfrm/a:off',ns).get('y','0'))>10000000]
for ch in list(tree):
 if ch not in keep:tree.remove(ch)
for t in r.findall('.//a:t',ns):
 if t.text=='음성 이벤트 감지':t.text='YAMNet 실환경 정확성 평가'
 if t.text=='8':t.text='9'
new=E.fromstring(g.read('ppt/slides/slide1.xml')).find('p:cSld/p:spTree',ns)
for ch in list(new)[2:]:tree.append(copy.deepcopy(ch))
for i,x in enumerate(tree.findall('.//p:cNvPr',ns),1):x.set('id',str(i))
d['ppt/slides/slide18.xml']=E.tostring(r,encoding='utf-8',xml_declaration=True)
rels=E.fromstring(d['ppt/slides/_rels/slide8.xml.rels'])
for x in list(rels):
 if x.attrib['Type'].endswith('/notesSlide'):rels.remove(x)
d['ppt/slides/_rels/slide18.xml.rels']=E.tostring(rels,encoding='utf-8',xml_declaration=True)
p=E.fromstring(d['ppt/presentation.xml']);lst=p.find('p:sldIdLst',ns);node=E.Element('{'+ns['p']+'}sldId',{'id':'400','{'+ns['r']+'}id':'rIdEval'});lst.insert(8,node);d['ppt/presentation.xml']=E.tostring(p,encoding='utf-8',xml_declaration=True)
f='ppt/_rels/presentation.xml.rels';rr=E.fromstring(d[f]);relNS='http://schemas.openxmlformats.org/package/2006/relationships';E.SubElement(rr,'{'+relNS+'}Relationship',{'Id':'rIdEval','Type':ns['r']+'/slide','Target':'slides/slide18.xml'});d[f]=E.tostring(rr,encoding='utf-8',xml_declaration=True)
f='[Content_Types].xml';rr=E.fromstring(d[f]);ctNS='http://schemas.openxmlformats.org/package/2006/content-types';E.SubElement(rr,'{'+ctNS+'}Override',{'PartName':'/ppt/slides/slide18.xml','ContentType':'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'});E.register_namespace('',ctNS);d[f]=E.tostring(rr,encoding='utf-8',xml_declaration=True)
# Update visible slide numbers only, retaining every other object.
for i in range(9,18):
 f=f'ppt/slides/slide{i}.xml';text=d[f].decode();text=text.replace(f'<a:t>{i}</a:t>',f'<a:t>{i+1}</a:t>');d[f]=text.encode()
with zipfile.ZipFile('.ppt-build/candidate.pptx','w',zipfile.ZIP_DEFLATED) as out:
 for n,b in d.items():out.writestr(n,b)
print('Draft: 18 slides; added after audio event slide')
