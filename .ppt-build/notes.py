import zipfile
from xml.sax.saxutils import escape
p='.ppt-build/candidate.pptx'
with zipfile.ZipFile(p) as z:d={n:z.read(n) for n in z.namelist()}
text='출처: yamnet/yamnet_realworld_eval.ipynb, 저장된 실행 결과 셀 16, 24, 47. Pi 마이크 24클립, 6개 카테고리. 교차검증은 음원 하나를 제외하고 나머지 음원으로 규칙 및 임계값을 선택한 뒤 제외한 음원을 평가하는 방식. macro F1은 카테고리별 F1의 단순 평균. 기존 0.510, 같은 데이터 자체평가 0.699, 음원 단위 교차검증 0.610. 기존 슬라이드의 운영 규칙과 튜닝 후보는 구분하며 운영 반영을 의미하지 않음. 같은 날·장소·마이크의 소규모 개발 평가이며 새 세션 검증 및 시간당 오경보율은 미확인.'
d['ppt/notesSlides/notesSlide18.xml']=('''<?xml version="1.0" encoding="UTF-8"?><p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>'''+escape(text)+'''</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>''').encode()
f='ppt/slides/_rels/slide18.xml.rels';s=d[f].decode();import xml.etree.ElementTree as E
r=E.fromstring(d[f]);E.SubElement(r,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',{'Id':'rIdEvalNotes','Type':'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide','Target':'../notesSlides/notesSlide18.xml'});d[f]=E.tostring(r,encoding='utf-8',xml_declaration=True)
f='[Content_Types].xml';s=d[f].decode().replace('</Types>','<Override PartName="/ppt/notesSlides/notesSlide18.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>');d[f]=s.encode()
with zipfile.ZipFile(p,'w',zipfile.ZIP_DEFLATED) as z:
 for n,b in d.items():z.writestr(n,b)
