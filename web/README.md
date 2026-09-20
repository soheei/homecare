# HomeCare Web

HomeCare의 웹 프론트엔드입니다. 보호자(가족)가 로그인해서 집 안 이벤트를 보고, AI(Claude)에게 "오늘 누가 왔어?"처럼 물어볼 수 있습니다.

> 최근 수정일시: 2026-09-20 (Vite 템플릿 기본 문서를 프로젝트 설명으로 교체, 배포 시 주의점 추가)

- 스택: React 19 + Vite + Tailwind, 인증은 Supabase Auth, 데이터는 백엔드 API 경유
- 배포: Vercel — https://homecare-9sr8.vercel.app/ (로컬: http://localhost:5173/)
- 백엔드: Render — https://homecare-9kcu.onrender.com (저장소 루트 [README.md](../README.md) 참고)

## 화면

로그인하면 하단 탭 4개가 나옵니다 (`src/App.jsx`).

| 탭 | 파일 | 내용 |
|---|---|---|
| 홈 | `src/screens/HomeScreen.jsx` | 요약, 최근 이벤트 |
| 채팅 | `src/screens/ChatScreen.jsx` | Claude와 대화 (`POST /api/chat/message`) |
| 이벤트 | `src/screens/EventsScreen.jsx` | 이벤트 목록 |
| 설정 | `src/screens/SettingsScreen.jsx` | 설정 |

이 밖에 로그인(`LoginScreen`)과 비밀번호 재설정(`/reset-password`) 화면이 있습니다.

## 백엔드 호출

`src/lib/api.js`가 로그인 세션의 토큰을 `Authorization: Bearer`로 붙여 백엔드를 호출합니다. 프로덕션 백엔드는 토큰이 없으면 401을 반환합니다.

## 실행

```bash
cd web
npm install
cp .env.example .env    # 값 채우기
npm run dev             # http://localhost:5173/
```

| 명령어 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 (Vite) |
| `npm run build` | 프로덕션 빌드 |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run lint` | oxlint 검사 |

## 환경변수

| 이름 | 설명 |
|---|---|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_API_URL` | 백엔드 주소. 로컬은 `http://localhost:3000`, 운영은 Render 주소 |

## 배포 시 주의

- Vite는 **빌드 시점에** `VITE_*` 값을 코드에 박습니다. Vercel에서 `VITE_API_URL`을 바꿨다면 반드시 **Redeploy**해야 반영됩니다. 값이 없으면 코드의 기본값(`http://localhost:3000`)이 박혀 방문자 PC로 요청이 가서 "불러오는 중..."에서 멈춥니다(2026-09-04에 실제로 발생).
- 백엔드의 `ALLOWED_ORIGINS`에 이 사이트의 주소(`https://homecare-9sr8.vercel.app`, 끝에 `/` 없이)가 들어 있어야 브라우저에서 CORS 오류가 나지 않습니다.
- Render 무료 플랜 백엔드는 유휴 후 첫 요청이 20초 넘게 걸릴 수 있어, 그동안 화면이 로딩 상태로 보일 수 있습니다.
