import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "file:///C:/Users/WCL/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const W = 20104100 / 9525;
const H = 11309350 / 9525;
const NAVY = "#172653";
const INK = "#24324B";
const TEAL = "#16877D";
const TEAL_DARK = "#0D6E66";
const TEAL_PALE = "#E4F3F0";
const SAND = "#F7F4ED";
const LINE = "#D8DEE7";
const MUTED = "#667085";
const WHITE = "#FFFFFF";
const RED = "#C94B35";

const p = Presentation.create({ slideSize: { width: W, height: H } });

function box(slide, { x, y, w, h, fill = "none", line = "none", radius = false, name }) {
  return slide.shapes.add({
    geometry: radius ? "roundRect" : "rect",
    name,
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: "solid", fill: line, width: line === "none" ? 0 : 1 },
  });
}

function text(slide, value, { x, y, w, h, size = 28, color = INK, bold = false, align = "left", name }) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    name,
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  shape.text = value;
  shape.text.style = { fontFamily: "Arial", fontSize: size, color, bold, alignment: align };
  return shape;
}

function header(slide, code, title, subtitle, page) {
  box(slide, { x: 0, y: 0, w: W, h: 286, fill: NAVY, name: "navy-header" });
  text(slide, code, { x: 105, y: 57, w: 120, h: 35, size: 22, color: "#87D7CE", bold: true });
  box(slide, { x: 105, y: 105, w: 42, h: 5, fill: TEAL, name: "section-rule" });
  text(slide, title, { x: 105, y: 128, w: 1730, h: 70, size: 46, color: WHITE, bold: true });
  text(slide, subtitle, { x: 105, y: 212, w: 1730, h: 42, size: 25, color: "#D5DDF1" });
  box(slide, { x: 105, y: 279, w: 1900, h: 5, fill: TEAL, name: "title-divider" });
  text(slide, String(page), { x: 1920, y: 1110, w: 80, h: 28, size: 18, color: MUTED, align: "right" });
  text(slide, "SEOULTECH", { x: 1685, y: 1095, w: 220, h: 36, size: 25, color: "#7C828A", bold: true, align: "right" });
}

// I2 — comparison slide. Preserve the navy title field and divider from the deck.
{
  const s = p.slides.add({ background: { fill: WHITE } });
  header(s, "I2", "시중 홈캠과 HOME-TALK 비교", "감지 이후의 기록 조회와 설명까지 보호자 경험으로 연결", 4);

  const x0 = 105, y0 = 324;
  const cols = [300, 450, 450, 700];
  const heads = ["비교 항목", "Tapo C225 V2", "eufy E220", "HOME-TALK 개발 앱"];
  let x = x0;
  for (let c = 0; c < cols.length; c++) {
    box(s, { x, y: y0, w: cols[c], h: 72, fill: c === 3 ? TEAL : NAVY });
    text(s, heads[c], { x: x + 20, y: y0 + 18, w: cols[c] - 40, h: 38, size: 25, color: WHITE, bold: true });
    x += cols[c];
  }

  const rows = [
    ["감지 범위", "사람·차량·반려동물\n울음·짖음·유리 파손", "사람·반려동물\n소리·울음", "방문·택배·낙상/의심\n생활·위험 소리 6종"],
    ["기록 확인", "감지 알림\n로컬·클라우드 저장", "감지 알림\n로컬·클라우드 저장", "위험 등급별 알림\n이벤트와 첨부 기록 조회"],
    ["자연어 질문", "공식 자료 미기재", "공식 자료 미기재", "“오늘 방문 기록 알려줘”\n질문에 맞는 기록 검색"],
    ["하루 브리핑", "공식 자료 미기재", "공식 자료 미기재", "하루 이벤트를 자연어로 요약\n앱에서 바로 확인"],
  ];
  const rowH = 120;
  for (let r = 0; r < rows.length; r++) {
    let rx = x0;
    const ry = y0 + 72 + r * rowH;
    for (let c = 0; c < cols.length; c++) {
      const fill = c === 3 ? TEAL_PALE : (r % 2 === 0 ? WHITE : SAND);
      box(s, { x: rx, y: ry, w: cols[c], h: rowH, fill, line: LINE });
      text(s, rows[r][c], {
        x: rx + 20, y: ry + 22, w: cols[c] - 40, h: rowH - 32,
        size: c === 0 ? 25 : 24,
        color: c === 3 ? TEAL_DARK : INK,
        bold: c === 0 || c === 3,
      });
      rx += cols[c];
    }
  }

  box(s, { x: 105, y: 920, w: 1900, h: 95, fill: NAVY, radius: true, name: "key-difference" });
  text(s, "HOME-TALK의 차별점", { x: 145, y: 938, w: 330, h: 40, size: 25, color: "#87D7CE", bold: true });
  text(s, "감지 결과를 나열하는 데서 끝나지 않고, 보호자의 질문을 기록 조회와 하루 브리핑으로 연결", {
    x: 475, y: 932, w: 1480, h: 52, size: 29, color: WHITE, bold: true,
  });
  text(s, "공식 제품 자료 기준(2026.10.26) · 미기재는 미지원 단정이 아님 · 상용 제품과 감지 성능을 직접 비교한 결과는 아님", {
    x: 105, y: 1035, w: 1600, h: 32, size: 18, color: MUTED,
  });
  s.speakerNotes.text = "비교 기준일: 2026-10-26. Tapo C225 V2 공식 사양: https://www.tapo.com/us/product/tapo-c225-security-camera/v2/1-pack/specs/ . eufy E220 공식 제품 페이지: https://www.eufy.com/products/t8410121 . 자연어로 과거 이벤트를 질의하는 기능과 하루 자연어 브리핑은 두 공식 자료에서 확인되지 않아 미기재로 표시. 스마트 스피커의 음성 제어와 기록에 대한 자연어 질의는 구분. HOME-TALK 근거: web/src/screens/HomeScreen.jsx, web/src/context/AppDataContext.jsx, web/src/lib/api.js, src/mcp/tools/event.tools.js, src/mcp/tools/camera.tools.js. HOME-TALK은 개발 프로토타입이며 상용 제품과 감지 성능을 직접 비교한 결과가 아님.";
}

// I3 — two concrete household scenarios and a large placeholder for the user's AI chat capture.
{
  const s = p.slides.add({ background: { fill: WHITE } });
  header(s, "I3", "생활 속 시연 시나리오", "이상 상황을 알림으로 받고, 영상과 AI 대화로 집 안의 상태를 확인", 5);

  const leftX = 105, leftW = 1165, rightX = 1320, rightW = 685;
  const scenarios = [
    {
      y: 330, h: 292, num: "01", label: "노부모 혼자 있는 집", accent: RED,
      situation: "보호자가 외출한 동안 부모님이 집에 혼자 계신 상황",
      event: "낙상 이벤트 발생 시 휴대폰 알림 수신",
      check: "이벤트 영상과 현재 화면을 확인하고 AI에 질문",
      question: "“방금 무슨 일이 있었어?”",
    },
    {
      y: 654, h: 292, num: "02", label: "베이비시터와 아이가 있는 집", accent: TEAL,
      situation: "맞벌이 부모가 외출하고 베이비시터가 아이를 돌보는 상황",
      event: "아이 울음소리 이벤트 발생 시 휴대폰 알림 수신",
      check: "저장된 소리 이벤트와 현재 화면을 확인하고 AI에 질문",
      question: "“아이 울음 이후 상황을 알려줘”",
    },
  ];
  for (const sc of scenarios) {
    box(s, { x: leftX, y: sc.y, w: 10, h: sc.h, fill: sc.accent, name: `scenario-${sc.num}-accent` });
    box(s, { x: leftX + 10, y: sc.y, w: leftW - 10, h: sc.h, fill: sc.num === "01" ? SAND : TEAL_PALE, line: LINE, name: `scenario-${sc.num}` });
    text(s, sc.num, { x: leftX + 42, y: sc.y + 28, w: 62, h: 34, size: 22, color: sc.accent, bold: true });
    text(s, sc.label, { x: leftX + 118, y: sc.y + 20, w: 850, h: 52, size: 31, color: NAVY, bold: true });
    text(s, "상황", { x: leftX + 42, y: sc.y + 88, w: 90, h: 30, size: 20, color: MUTED, bold: true });
    text(s, sc.situation, { x: leftX + 145, y: sc.y + 84, w: 935, h: 42, size: 23, color: INK });
    box(s, { x: leftX + 42, y: sc.y + 140, w: 1000, h: 2, fill: LINE });
    text(s, "알림", { x: leftX + 42, y: sc.y + 158, w: 90, h: 30, size: 20, color: sc.accent, bold: true });
    text(s, sc.event, { x: leftX + 145, y: sc.y + 154, w: 935, h: 42, size: 23, color: INK, bold: true });
    text(s, "확인", { x: leftX + 42, y: sc.y + 205, w: 90, h: 30, size: 20, color: TEAL_DARK, bold: true });
    text(s, sc.check, { x: leftX + 145, y: sc.y + 201, w: 935, h: 42, size: 23, color: INK });
    text(s, sc.question, { x: leftX + 145, y: sc.y + 246, w: 900, h: 36, size: 22, color: NAVY, bold: true });
  }

  box(s, { x: rightX, y: 330, w: rightW, h: 616, fill: "#F7F9FC", line: NAVY, radius: true, name: "ai-chat-screenshot-placeholder" });
  text(s, "AI 대화 화면", { x: rightX + 42, y: 370, w: rightW - 84, h: 50, size: 31, color: NAVY, bold: true, align: "center" });
  box(s, { x: rightX + 88, y: 457, w: rightW - 176, h: 285, fill: WHITE, line: LINE, radius: true, name: "screenshot-drop-zone" });
  text(s, "실제 앱 화면\n캡처 삽입", { x: rightX + 118, y: 540, w: rightW - 236, h: 100, size: 30, color: MUTED, bold: true, align: "center" });
  box(s, { x: rightX + 112, y: 772, w: rightW - 224, h: 2, fill: LINE });
  text(s, "발표 전 캡처 이미지로\n이 영역을 교체", { x: rightX + 80, y: 810, w: rightW - 160, h: 72, size: 23, color: TEAL_DARK, bold: true, align: "center" });

  text(s, "※ 시연 전 브라우저 알림 허용과 카메라 연결 상태 확인", { x: 105, y: 995, w: 1350, h: 32, size: 19, color: MUTED });
  s.speakerNotes.text = "시연 예시이며 실제 사고 확정이나 고정 알림 지연시간을 보장하지 않음. 첫 번째 시나리오는 거실 모드에서 낙상 감지 또는 낙상 의심 이벤트가 생성되고 알림을 받은 뒤 이벤트 영상과 현재 화면을 확인하는 흐름. 두 번째 시나리오는 아이 울음소리 이벤트 알림 뒤 저장된 이벤트와 현재 화면을 확인하는 흐름. AI 대화 화면 영역은 발표자가 실제 앱 캡처로 교체. 시연 전 로그인, 네트워크, 장치 하트비트, 브라우저 알림 허용, 카메라 연결과 모드 반영을 확인. 출처: web/src/screens/HomeScreen.jsx, web/src/lib/api.js, web/src/context/AppDataContext.jsx, src/mcp/tools/event.tools.js, src/mcp/tools/camera.tools.js.";
}

await fs.mkdir(".ppt-build", { recursive: true });
await (await PresentationFile.exportPptx(p)).save(".ppt-build/i2-i3-scenario-revision.pptx");

