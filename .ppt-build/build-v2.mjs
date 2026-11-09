import fs from 'node:fs/promises';
import {Presentation,PresentationFile} from 'file:///C:/Users/WCL/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const p=Presentation.create({slideSize:{width:20104100/9525,height:11309350/9525}});
function txt(s,text,x,y,w,h,size=32,color='#13233A',bold=false){let a=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});a.text=text;a.text.style={fontFamily:'Arial',fontSize:size,color,bold};return a;}
function table(s,values,y,height,widths,size=30,emphasis=-1){const t=s.tables.add({rows:values.length,columns:widths.length,left:398,top:y,width:1460,height,columnWidths:widths,values});t.borders.assign({fill:'#C8C2B5',width:1});for(let r=0;r<values.length;r++)for(let c=0;c<widths.length;c++){const a=t.getCell(r,c);a.fill=r===0?'#13233A':c===emphasis?'#E3F0EE':r%2?'#FDFCF9':'#F4F1EA';a.text.style={fontFamily:'Arial',fontSize:size,color:r===0?'#FFFFFF':'#13233A',bold:r===0||c===emphasis};}return t;}
// Content slide 1: audio evaluation, all revised values from notebook cell 24.
let s=p.slides.add();
txt(s,'Pi 마이크 24클립 · 6개 소리 분류 · ESC-50 2,000클립으로 오경보 점검',398,290,1460,55,30);
txt(s,'평균 F1   0.510  →  0.610',398,362,1450,80,56,'#1D7C74',true);
txt(s,'기존 설정과 음원 단위 교차검증 비교 · Precision·Recall은 교차검증 기준',398,448,1480,48,28);
const ev=[['소리 종류','Precision','Recall','F1 기존','F1 교차검증'],['경보음·사이렌','0.500','0.333','0.400','0.400'],['유리 파손·충격','1.000','0.667','0.500','0.800'],['아기 울음','0.750','1.000','0.750','0.857'],['비명·고함','0.000','0.000','0.000','0.000'],['초인종·노크','0.750','0.500','0.500','0.600'],['반려동물 소리','1.000','1.000','0.909','1.000']];
const et=table(s,ev,525,390,[430,260,230,260,280],30,4);
for(let c=0;c<5;c++)et.getCell(4,c).text.style={fontFamily:'Arial',fontSize:30,color:'#B83A26',bold:c===4};
txt(s,'Precision(정밀도): 감지한 것 중 정답 비율   Recall(재현율): 실제 소리 중 감지한 비율',398,936,1490,43,24);
txt(s,'F1: 정밀도·재현율의 조화평균(0~1)   한계: 동일 세션 24클립, 새 음원·날짜로 검증 필요',398,988,1490,43,24,'#B83A26');
s.speakerNotes.text='출처: yamnet/yamnet_realworld_eval.ipynb 저장 실행 결과 셀 16, 24, 47. 기존 macro F1 0.510, 자체평가 0.699, 음원 단위 교차검증 0.610. Precision 및 Recall은 셀 24의 교차검증 값. 음원 하나를 통째로 제외하고 나머지로 설정을 선택한 뒤 제외한 음원을 평가. 자체평가 점수는 선택 데이터 재사용으로 낙관적이므로 주지표에 사용하지 않음. 비명·고함은 예측 양성 0건으로 노트북의 zero-division 처리에 따라 Precision 0 표시. 동일 날·장소·마이크의 개발 표본이며 장시간 배경 소음과 운영 성능은 검증 안 됨. 규칙 및 임계값의 운영 반영을 의미하지 않음.';
// Content slide 2: product comparison. Emphasize last column while preserving source palette.
s=p.slides.add();
txt(s,'질문으로 기록을 찾고, 하루의 변화를 브리핑',398,295,1470,65,44,'#1D7C74',true);
txt(s,'감지 기능에 대화형 조회와 요약을 연결한 보호자용 서비스',398,368,1470,45,30);
const cp=[['비교 항목','Tapo C225 V2','eufy E220','HOME-TALK 개발 앱'],['영상 이벤트','사람·차량·반려동물','사람·반려동물','방문·택배·낙상/의심'],['소리 이벤트','울음·짖음·야옹\n유리 파손','소리·울음 감지','생활·위험 소리 6종\n카메라 기록과 함께 조회'],['알림·기록','감지 알림\n로컬·클라우드 저장','감지 알림\n로컬·클라우드 저장','위험 등급별 알림\n이벤트·첨부 기록 조회'],['기록에 자연어 질문','공식 자료 미기재','공식 자료 미기재','“오늘 방문 기록 알려줘”\n질문에 맞는 기록 조회'],['하루 자연어 브리핑','공식 자료 미기재','공식 자료 미기재','하루 이벤트 요약 생성\n앱에서 확인']];
table(s,cp,438,480,[220,350,330,560],27,3);
txt(s,'공식 제품 자료 기준(2026.10.26) · 미기재는 미지원 단정이 아님 · 지역·버전에 따라 다를 수 있음',398,946,1490,44,23);
txt(s,'HOME-TALK은 개발 프로토타입이며, 상용 제품과 감지 성능을 직접 비교한 결과는 아님',398,995,1490,44,23,'#B83A26');
s.speakerNotes.text='비교 기준일: 2026-10-26. 비교 대상은 명시한 두 모델의 공식 자료이며 전체 시장에서의 독점적 우위를 뜻하지 않음. Tapo C225 V2 공식 사양: https://www.tapo.com/us/product/tapo-c225-security-camera/v2/1-pack/specs/ (사람·차량·반려동물, 울음·야옹·짖음·유리 파손, 로컬 microSD 및 유료 Tapo Care, 시스템 알림). eufy E220 공식 제품 페이지: https://www.eufy.com/products/t8410121 (사람·반려동물·오디오·울음 감지, 알림, microSD·선택 클라우드). 자연어로 과거 이벤트를 질의하는 기능과 하루 자연어 브리핑은 위 모델 자료에서 확인되지 않아 미기재로 표시. 스마트 스피커의 음성 제어와 기록에 대한 자연어 질의는 구분. HOME-TALK 근거: web/src/screens/HomeScreen.jsx, web/src/context/AppDataContext.jsx, web/src/lib/api.js, src/mcp/tools/event.tools.js, src/mcp/tools/camera.tools.js, vision/ 및 yamnet/ 평가 기록. 영상과 소리는 개별 감지 후 이벤트로 통합하며 하나의 다중모달 모델이 공동 추론한다고 주장하지 않음. 소리 6종은 구현 범위이며 모두 높은 검출률을 보장하지 않음(비명·고함 교차검증 0). 운영 기기·배포 종단 간 동작은 본 문서 편집 중 실행하지 않음.';
// Content slide 3: early demo overview, no invented actual event timestamp.
s=p.slides.add();
txt(s,'보호자가 외출한 동안, 집의 변화를 확인하는 과정',398,295,1470,65,42,'#1D7C74',true);
txt(s,'현관 모드의 방문·초인종 이벤트로 감지부터 브리핑까지 시연',398,368,1470,45,30);
const dm=[['순서','시연 행동','앱에서 확인할 내용'],['01  준비','로그인 후 현관 모드 선택\n카메라·마이크 연결 확인','현관 모드와 기기 상태'],['02  이벤트','방문자가 지정 구역에 머무름\n초인종 소리 재생','방문·소리 이벤트가\n기록에 추가되는 과정'],['03  기록 확인','이벤트 목록에서 해당 기록 선택','시간·종류·연결된 첨부 확인'],['04  대화형 조회','“오늘 방문 기록 알려줘” 질문','저장된 방문 기록을 바탕으로 답변'],['05  하루 요약','홈에서 브리핑 생성\n현재 화면 보기 선택','하루 요약과 현재 집 사진 확인']];
table(s,dm,438,480,[230,620,610],29);
txt(s,'위험 알림 예시: 검증한 경보음 재생 후 알림 확인(거실 모드·알림 권한 사전 설정)',398,947,1490,46,24);
txt(s,'모드 반영·이벤트 저장을 확인한 뒤 다음 단계 진행 · 사람의 신원 식별을 의미하지 않음',398,998,1490,42,24,'#B83A26');
s.speakerNotes.text='시연 예시이며 실제 실행 결과나 고정 지연시간을 보장하지 않음. 사용 흐름은 현재 웹 코드의 현관/거실 모드, 이벤트 목록, 자연어 채팅, 홈 브리핑, 현재 화면 촬영 기능 기준. 시연 전 로그인·네트워크·장치 하트비트·브라우저 알림 허용·구독과 해당 모드 반영을 확인. 설정 변경의 엣지 반영은 하트비트에 따르므로 확정된 초 단위 지연을 제시하지 않음. 현관 모드에서 방문과 초인종을 먼저 시연하고, 위험 알림은 거실 모드에서 별도 검증한 경보음으로 선택 시연. 노트북 경보음 교차검증 Recall이 0.333이므로 아무 음원으로 성공을 가정하지 않음. 방문자의 이름/가족 여부 등 신원 식별을 시연하지 않음. 새 데이터가 서버에 저장된 뒤 질의·브리핑 생성. 실패 시 실제 상태를 설명하며 사전 저장 기록을 사용하면 그 사실을 밝힘. 출처: web/src/screens/HomeScreen.jsx, web/src/lib/api.js, web/src/context/AppDataContext.jsx, src/mcp/tools/event.tools.js, src/mcp/tools/camera.tools.js.';
await (await PresentationFile.exportPptx(p)).save('.ppt-build/content-v2.pptx');
