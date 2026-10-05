---
name: deploy-check
description: Render 배포 직후 인증 우회 사고가 없는지 확인한다(/health의 environment, 토큰 없는 /api/chat/history의 401).
disable-model-invocation: true
---

# deploy-check

`main` push 후 Render 자동 배포가 끝났을 때 사용자가 `/deploy-check`로 호출한다. Render에 `NODE_ENV=development`가 들어가면 인증이 통째로 우회된 사고가 있었기 때문에 두 가지를 확인한다. 읽기 전용 확인이며 아무것도 수정하지 않는다.

외부 서비스(Render)에 접근하므로 `curl`은 `settings.json`의 `ask` 규칙에 따라 실행 전에 승인을 받는다. 승인 없이 실행하지 않는다.

## 1. 환경 확인
```
curl -s --max-time 60 https://homecare-9kcu.onrender.com/health
```
- 무료 인스턴스는 처음 응답이 느릴 수 있다. 시간 초과면 1회만 다시 시도한다.
- 응답의 `environment`가 `production`이어야 한다.

## 2. 인증 확인
```
curl -s -o /dev/null -w "%{http_code}\n" --max-time 60 https://homecare-9kcu.onrender.com/api/chat/history
```
- 토큰 없이 호출하므로 `401`이어야 한다. `200`이면 인증이 우회된 상태다.
- 어떤 토큰도 요청에 넣지 않는다. `.env`를 읽지 않는다.

## 3. 결과 보고
- 두 항목의 기대값, 실제값, 통과/실패를 표로 보고한다.
- 실패하면 원인으로 Render 대시보드의 `NODE_ENV` 값을 확인하라고 안내한다. 대시보드 접근은 사용자가 직접 한다. 환경변수 값은 추측하지 않고, 확인하지 못한 것은 **확인 필요**로 표시한다.
- 엣지 저장 확인(응답 `id`가 UUID인지, Render 로그에 `Error creating event`가 없는지)은 이 스킬 범위 밖이다.
