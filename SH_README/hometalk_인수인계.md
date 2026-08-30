# HomeCare 서버 배포/인프라 인수인계 문서

> 작성일시: 2026-08-30
> 최근 수정일시: 2026-08-30 (최초 작성 — GitHub 접근 환경, 프론트/백엔드 배포 현황, Docker 배포 절차 반영)
> #가장 최근 일시의 md를 우선시 할것.
> 작성자: (이름 기입)
> 대상: 다음 팀원 / 후속 개발자
> 프로젝트: HomeCare Backend — 라즈베리파이 서버 배포/인프라

> **기록 원칙**: 이 문서는 배포 상태·접근 정보·운영 절차 등 **구조적인 내용 전용**. 날짜별 작업 로그(무엇을 했고
> 무엇을 검증했는지)는 새 문서를 또 만들지 말고 같은 폴더의 `hometalk_진행일지.md`에 계속 이어서 기록할 것.
> 이 문서 자체는 배포 상태가 바뀌거나 인계 항목이 갱신될 때만 수정하고, 수정 시 위 "최근 수정일시"를 갱신한다.
> 더이상 유효하지 않은 내용은 삭제한다.

---

라즈베리파이(`/home/alarmi/homecare`) 서버 환경 인수인계 문서입니다.
최신 상세 이력은 [`hometalk_진행일지.md`](./hometalk_진행일지.md)를 참고하세요.

## 현재 배포 상태 (2026-08-30 기준)

- **프론트엔드**: Vercel 배포 완료 — https://homecare-9sr8.vercel.app/ (로컬 개발: http://localhost:5173/)
- **백엔드**: Docker Compose로 라즈베리파이에 배포 완료
  - `homecare-backend` 컨테이너, `0.0.0.0:3000`, `/health`로 상태 확인
  - `homecare-mcp`는 기본 실행에서 제외 (stdio 기반이라 상시 데몬으로 못 띄움, 실제로도 백엔드가 필요로 하지 않음)

## 서버 접근 / 계정

- GitHub 계정: `soheei` (gh CLI로 인증됨, HTTPS 프로토콜)
- 저장소 경로: `/home/alarmi/homecare`
- OS: Debian 13 (trixie), aarch64
- `.env`는 git에 커밋되지 않음 — 서버 로컬에 직접 위치 (`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `EDGE_DEVICE_SECRET` 등 채워져 있음)

## 배포/운영 명령어

```bash
cd /home/alarmi/homecare

# 재배포 (코드 변경 후)
git pull
docker compose up -d --build backend

# 상태 확인
docker ps
curl http://localhost:3000/health
docker logs homecare-backend --tail 50

# mcp 서버를 수동으로 테스트하고 싶을 때만
docker compose run --rm -i mcp
```

> 참고: `docker` 그룹 권한이 아직 로그인 세션에 반영되지 않은 사용자라면 `sg docker -c "..."`로 우회하거나, 재로그인 후 `docker` 명령을 바로 사용하세요.

## 알려진 이슈 / 남은 일

- `docker-compose.yml`의 `version` 속성 obsolete 경고 (동작엔 무관, 정리 권장)
- Node.js 18 deprecated 경고 — `node:20-alpine`으로 업그레이드 고려
- MCP stdio 서버(`src/mcp/server.js`)는 현재 구조상 실사용 안 됨. 향후 외부 MCP 클라이언트 연동이 필요해지면 별도 검토 필요
