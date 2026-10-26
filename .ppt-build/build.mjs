import fs from 'node:fs/promises';
import {Presentation,PresentationFile,FileBlob} from 'file:///C:/Users/WCL/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const source=await PresentationFile.importPptx(await FileBlob.load('최종 데모용.pptx'));
await fs.writeFile('.ppt-build/source8.png',new Uint8Array(await (await source.export({slide:source.slides.items[7],format:'png',scale:0.7})).arrayBuffer()));
const p=Presentation.create({slideSize:{width:20104100/9525,height:11309350/9525}});const s=p.slides.add();
function txt(text,x,y,w,h,size=32,color='#13233A',bold=false){let a=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});a.text=text;a.text.style={fontFamily:'Arial',fontSize:size,color,bold};return a;}
txt('Pi 마이크 24클립 · 6개 소리 분류 · ESC-50 2,000클립으로 오경보 점검',398,290,1460,55,30);
txt('평균 F1   0.510  →  0.610',398,362,1450,80,56,'#1D7C74',true);
txt('기존 설정 대비 음원 단위 교차검증 결과  +0.100',398,448,1450,55,32);
const v=[['소리 종류','F1 기존','F1 교차검증','교차검증 검출률'],['경보음·사이렌','0.400','0.400','33.3% (1/3)'],['유리 파손·충격','0.500','0.800','66.7% (2/3)'],['아기 울음','0.750','0.857','100% (3/3)'],['비명·고함','0.000','0.000','0% (0/3)'],['초인종·노크','0.500','0.600','50.0% (3/6)'],['반려동물 소리','0.909','1.000','100% (6/6)']];
const t=s.tables.add({rows:7,columns:4,left:398,top:525,width:1460,height:390,columnWidths:[490,285,320,365],values:v});
t.borders.assign({fill:'#C8C2B5',width:1});
for(let r=0;r<7;r++)for(let c=0;c<4;c++){let a=t.getCell(r,c);a.fill=r===0?'#13233A':r%2?'#FDFCF9':'#F4F1EA';a.text.style={fontFamily:'Arial',fontSize:30,color:r===0?'#FFFFFF':r===4?'#B83A26':'#13233A',bold:r===0||c===2};}
txt('F1: 오경보와 놓침을 함께 평가하는 점수(0~1)   검출률: 실제 소리 중 감지한 비율',398,940,1490,48,24);
txt('한계: 같은 날·장소의 소규모 표본. 다른 날·새 음원 검증과 장시간 배경 녹음 필요',398,994,1490,48,24,'#B83A26');
await (await PresentationFile.exportPptx(p)).save('.ppt-build/content.pptx');

