---
paths:
  - "database/**"
---

# 데이터베이스 규칙

- `database/schema.sql` 맨 아래에 샘플 INSERT가 있다. 파일 전체를 운영 Supabase에서 실행하면 가짜 데이터가 들어간다. 전체 실행하지 않는다.
- `schema.sql`을 바꿔도 운영 DB는 바뀌지 않는다. 필요한 `ALTER`만 Supabase SQL Editor에서 따로 실행한다.
- 마이그레이션 도구가 없다. 테이블 구조를 바꿀 때는 운영 Supabase와 어긋나지 않는지 확인한다. 동기화 여부는 **확인 필요**.
- `events.id`와 `devices.id`를 혼동하지 않는다. 엣지의 `HOMECARE_DEVICE_ID`(= `X-Device-Id`)는 `devices` 행 id여야 한다.
