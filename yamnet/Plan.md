# YAMNet 오디오 이벤트 분류 — 통합 구현 계획

> 이 폴더(`homecare/yamnet/`, 2026-09-04부로 homecare 저장소 하위로 이동)에서 오디오 캡처 → YAMNet 추론 → 이벤트 판정 → 라벨링까지
> 전체 음성 분류 파이프라인을 구현한다. homecare 백엔드 전송/DB 스키마/UI는 이 파이프라인의
> 출력을 소비하는 별도 작업으로, 여기서는 설계 참고용으로만 다루고 실제 구현은 homecare
> 저장소 쪽에서 진행한다.

---

## 0. 문서 구성

이 계획은 두 개의 참고 자료를 통합한다.

- **참고 A** (`참고.md`): "미지의 돌발음"을 사전 라벨 없이 탐지할 수 있는지 검증한 실험
  (YAMNet score/embedding의 프레임 간 변화량 기반 novelty detection)
- **참고 B** (2026-09-04 작성): 홈톡의 알려진 이벤트 카테고리(아기 울음/유리 파손/화재/방문자 등)를
  AudioSet 클래스에 직접 매핑하고, 알림 정책·엣지/서버 아키텍처·사용자 커스터마이징까지 다룬
  실전 설계안

두 접근은 상충하지 않고 **역할이 다르다**: 참고 B는 "이미 알고 있는 위험 신호"를 정확히 잡아내는
메인 로직이고, 참고 A는 "전혀 예상 못한 소리"까지 놓치지 않기 위한 보조·후순위 안전망이다.
통합 방향은 §4에서 정리한다.

---

## 1. 참고 A 요약: `참고.md` (이상음 탐지 실험)

`참고.md`는 YAMNet으로 "무슨 소리인지 맞추기"가 아니라 "평소와 다른 소리가 들어왔는지"를
탐지할 수 있는지 검증한 실험 기록이다.

### 실험 구성
- **정상음**: rain, sea_waves, wind, clock_tick (ESC-50)
- **돌발음**: crying_baby, door_wood_knock, glass_breaking, siren, car_horn, fireworks (ESC-50)
- **fold 분리** (ESC-50은 fold 1~5, 데이터 유출 방지를 위해 용도별로 분리):
  | 용도 | fold | clip 수 |
  |---|---|---|
  | 정상음 기억(reference) | 1~3 | 96 |
  | 임계값 결정 | 4 | 32 |
  | 오탐(false alarm) 평가 | 5 | 32 |
  | 돌발 이벤트 평가 | 5 | 48 스트림(5초, 배경+이벤트 합성) |
- 이벤트 음량: 배경 대비 -10/-5/0/+5 dB 4단계로 합성

### 탐지 방식 5가지 비교
1. **spectral flux** — 32ms 단위 주파수 급변 (YAMNet 불필요)
2. **score delta** — 직전 프레임 대비 521차원 score 변화량(cosine distance)
3. **embedding delta** — 직전 프레임 대비 1024차원 embedding 변화량
4. **score kNN** — 정상음 기억(96 clip) 중 가장 가까운 5개와의 거리
5. **embedding kNN** — 위와 동일하되 embedding 사용

### 결과
| detector | AUROC | precision | recall | F1 | 오alert/시간 |
|---|---|---|---|---|---|
| spectral flux | 0.449 | 0.000 | 0.0% | 0.000 | 0.0 |
| score delta | 0.717 | 0.810 | 35.4% | 0.493 | 22.5 |
| embedding delta | **0.734**(최고 AUROC) | 0.765 | 27.1% | 0.400 | 22.5 |
| score kNN | 0.661 | 1.000 | 6.2% | 0.118 | 0.0 |
| embedding kNN | 0.632 | 0.800 | 16.7% | 0.276 | 0.0 |
| **score delta + embedding delta (fusion)** | — | 0.786 | **45.8%**(최고 recall) | **0.579**(최고 F1) | 22.5 |

### 핵심 결론
1. "정상음과 얼마나 다른가"(kNN)보다 **"직전 순간과 얼마나 다른가"(delta)** 가 더 효과적.
2. 최선의 fusion도 recall 45.8%뿐 — **단독 안전 감시 수단으로는 부족**, 보조 신호로만 사용.
3. **YAMNet top label 신뢰도가 낮음** — novelty score가 높아도 top label이 실제 소리와 다를 수
   있음(유리음 8건 중 top이 "Glass"였던 건 3건뿐). → "이상 탐지"와 "라벨링"은 별도 문제.
4. 작은 음량(-10dB)일수록 탐지율 급락 (33.3% → +5dB 66.7%).
5. 처리 속도는 문제없음(RTF 0.006~0.007x, Mac M4 Max 기준 — 라즈베리파이 실측 별도 필요).
6. YAMNet 최소 관측 지연 0.415초 (0.96초 윈도우 구조상 하한선).

---

## 2. 참고 B: 홈톡 오디오 이벤트 분류 설계안 (2026-09-04)

> 아래는 사용자가 별도로 작성/정리한 설계안 원문이다. 그대로 보존하고, §4에서 참고 A와
> 통합한 최종 방향을 정리한다.

### 전제
YAMNet은 오디오 전용 분류기(521개 AudioSet 클래스, 16kHz 모노, 0.96초 프레임 50% 오버랩).
홈톡 이벤트 카테고리(움직임/낙상/아기 울음/유리 파손/화재/방문자·초인종) 중 오디오로 감지
가능한 항목만 YAMNet 담당, 움직임은 카메라(비전) 담당.

### 2.1 YAMNet의 역할
- 최종 판단이 아니라 1차 필터링(coarse classifier)으로 배치
- 마이크 스트림 → 0.96초 청크 → YAMNet 추론 → 관련 클래스 점수 추출 → 임계값 통과 시 다음
  단계(알림/2차 LLM 검증)로 전달
- 재학습보다는 특징 추출기로 쓰고 위에 경량 분류기를 얹는 transfer learning이 2단계 개선안
  (1단계는 기본 클래스 매핑으로 시작)

### 2.2 AudioSet 클래스 → 홈톡 이벤트 매핑 (공식 yamnet_class_map.csv 기준)

| 홈톡 이벤트 | 매핑 클래스 (index) | 비고 |
|---|---|---|
| 아기 울음 | Baby cry, infant cry (20), Crying, sobbing (19) | OR 결합 권장 |
| 유리 파손 | Glass (35), Shatter (437) | 동시 상승 시 신뢰도 ↑ |
| 화재 | Fire alarm (394), Alarm (382), Siren (390) | "화재경보음" 감지이지 실제 불소리 아님에 유의 |
| 방문자/초인종 | Doorbell (349), Ding-dong (350) | 오탐 적은 편 |
| 낙상 | 해당 클래스 없음 | Thump, thud (454) + Groan(33)/Screaming(11)/Shout(6) 조합을 대리 신호로 사용, 신뢰도 낮아 카메라/가속도계와 결합 필요 |
| 움직임 | 해당 없음 | 카메라 담당 |

### 2.3 오탐 감소 후처리 전략
- 단일 프레임 임계값만: 구현 쉬우나 오탐 많음 (비추천)
- N-프레임 다수결: 아기 울음처럼 지속형 이벤트에 적합
- 클래스 조합 + 시간창 규칙: 화재/유리파손 등 고위험·순간형 이벤트에 적합 (추천), 예)
  Glass+Shatter 동시 발생, Thud→Scream 순차 발생

### 2.4 알림 정책 (위험도 기반)

| 위험도 | 이벤트 | 알림 방식 |
|---|---|---|
| 높음 | 화재, 유리 파손 | 즉시 푸시, 쿨다운 없이 매번 |
| 중간 | 낙상 의심(충격음+비명 조합) | 즉시 푸시 + "의심" 라벨 명시 |
| 낮음 | 아기 울음, 방문자/초인종 | 인앱 알림 + 5~10분 쿨다운, 일일 요약 포함 가능 |

쿨다운(재알림 억제) 로직 필수 — 없으면 알림 폭탄 발생.

### 2.5 아키텍처: 엣지 vs 서버 추론
- 엣지(TFLite) 추론: 프라이버시 유리, 지연 없음 / 기기 성능·전력 제약, 배포 관리 필요
- 서버 추론: 구현 간단, MCP·LLM 통합 쉬움 / 상시 음성 스트리밍은 부모님 댁 맥락상 프라이버시
  민감, 대역폭 비용

추천 방향: 엣지에서 YAMNet으로 1차 필터링 → 이벤트 판정 시에만 짧은 구간(전후 3~5초) 서버
전송 → 로드맵 2순위(고위험 이벤트 LLM 비전 2차 검증)와 자연스럽게 연결.

### 2.6 위험도 사용자 설정 (커스터마이징)

세 가지 대안:
- A. 위험도 라벨 자체를 사용자가 재정의 — 유연성 최대, 단 안전 필수 이벤트를 실수로 낮출 위험
- B. 위험도는 고정, 위험도별 알림 방식만 사용자가 조절 — 안전하지만 개인화 요구를 못 받아줌
- C. 민감도(threshold)만 "둔감/보통/민감" 3단계로 조절 — 모델 내부값 노출 없이 오탐/누락
  트레이드오프 조정 가능

추천: A + C 조합, 단 화재·유리 파손 등 안전 필수 이벤트는 "완전 무음" 옵션을 막고 최소
인앱 알림을 강제하는 안전장치 유지.

구현: `default_risk_level`(시스템 기본값) + user override 구조.
```
sound_categories (마스터, 시스템 정의)
- category_id, label, audioset_class_ids[], default_risk_level, locked(bool)

user_category_settings (사용자별 override, 있을 때만 우선 적용)
- user_id, category_id, enabled(bool), risk_level, notify_method, cooldown_minutes
```
라우팅 로직: `사용자 override 있으면 그걸 사용, 없으면 default_risk_level`. `locked=true`
카테고리(경보음/사이렌, 파손/충격음)는 사용자가 조절하더라도 "완전 무음"까지는 서버에서
막음 — default + 제한된 범위 내 조절.

### 2.7 키워드 기반 소리 카테고리 (2.6의 확장안)

2.6의 이벤트 6종 고정 구조를, AudioSet 521개 클래스를 활용한 "키워드 그룹" 단위로 확장하는 안.

세 가지 대안:
- A. 521개 클래스 전부 노출, 개별 선택 — 최대 유연성이지만 무관한 클래스(악기류 등)까지
  노출돼 UX 붕괴
- B. AudioSet 온톨로지 상위 카테고리 그대로 사용 (Human sounds / Animal / Music / Natural
  sounds / Sounds of things / Source-ambiguous sounds / Channel·environment) — 새로 설계할
  필요 없으나 홈 안전과 무관한 카테고리가 섞임
- C. 홈 안전 도메인에 맞게 큐레이션한 키워드 그룹 (30~50개 클래스를 의미 단위로 그룹핑) —
  UX 깔끔, 홈톡 맥락에 최적화

추천: C, 단 B(AudioSet 온톨로지)를 참고 자료로 삼아 처음부터 새로 설계하지 않음.

기본 그룹 (6개 이벤트 기반):

| 키워드 그룹 | 포함 클래스(예시) | 기본 위험도 |
|---|---|---|
| 아기/사람 위급 소리 | Baby cry·infant cry, Crying·sobbing, Screaming, Shout, Groan | 중간~높음 |
| 파손/충격음 | Glass, Shatter, Thump·thud, Crack | 높음 |
| 경보음/사이렌 | Fire alarm, Alarm, Siren | 높음 (locked) |
| 출입/방문 | Doorbell, Ding-dong, Knock | 낮음 |
| 동물 소리 | Bark, Meow 등 | 낮음, 기본 OFF |
| 생활 소음(알림 없음, 로그용) | TV, Music, Speech | 알림 대상 아님 — 오탐 디버깅용 |

#### 2.7.1 추가 후보 그룹 (돌봄 모니터링 관점 재검토, yamnet_class_map.csv 확인 완료)

| 후보 그룹 | 클래스(index) | 추천 여부 | 이유 |
|---|---|---|---|
| 건강 이상 신호음 | Cough(42), Sneeze(44), Snoring(38), Wheeze(37) | 추천 | 즉시 알림보다 일일 브리핑에 빈도 집계로 반영 |
| 문/보안 | Door(348), Slam(352), Knock(353) | 추천 | 기존 "출입/방문"은 초인종만 커버 — 초인종 없이 문이 열리거나 세게 닫히는 상황 포착 |
| 주방 위험 전조 | Water tap·faucet(364), Boiling(450), Microwave oven(362), Dishes·pots·pans(358) | 조건부 추천 | 단일 프레임 감지로는 의미 없음, "물소리 30분 이상 지속" 같은 지속시간 기반 로직 추가 구현 필요 |
| 장시간 무음/무활동 | Silence(494) + 활동성 클래스(Speech, Walk·footsteps(48)) 부재 | 강력 추천 | 개별 클래스 감지가 아니라 "지난 N시간 활동 신호 전혀 없음" 메타 규칙. 독거 부모님 안부 확인용, 캡스톤 차별점 가능 |
| 외부 사이렌(구급차/소방차/경찰차/민방위) | Ambulance(318), Police car(317), Fire engine(319), Civil defense siren(391) | 비추천 | 실내 마이크 기준 길거리 통과음일 확률 높아 오탐/노이즈만 증가 |

추가 우선순위: 장시간 무음/무활동 > 문/보안 > 건강 이상 신호음 > 주방 위험 전조 (지속시간
로직 필요해 공수 더 큼).

재확인된 한계: **"Fall"(낙상), "Gas"·"Stove"(가스레인지) 전용 AudioSet 클래스 없음** —
오디오만으로 커버 불가, 별도 센서(가속도계/가스·온도 센서) 결합 필요.

구현: `event_type` 대신 `category_id` 사용, 2.6 구조 그대로 확장. `locked=true` 카테고리는
완전 OFF·무음 설정 불가 (2.6 안전장치 그대로 적용). 내부적으로는 2.3의 클래스 조합/threshold
로직이 카테고리 단위로 동일하게 작동.

### 2.8 (참고 B) 확인 필요 / 참고 링크
- 실제 타겟 하드웨어에서 YAMNet 실시간 처리 지연/전력 소비 벤치마크
- Fire alarm/Alarm 클래스의 실제 가정용 화재경보기 소리 리콜 — 실측 테스트 필요
- https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/README.md
- https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/yamnet_class_map.csv

---

## 3. ESC-50 데이터셋과 키워드 그룹의 실제 매칭 현황

`ESC-50/` 클론 완료(2000 클립, 50 카테고리, fold 1~5, `meta/esc50.csv`). 실제 카테고리 50개를
확인해서 참고 B의 키워드 그룹과 대조한 결과:

| 홈톡 키워드 그룹 | 매칭되는 ESC-50 카테고리 | 커버리지 |
|---|---|---|
| 파손/충격음 | `glass_breaking` | O (직접 매칭) |
| 경보음/사이렌 | `siren`, `clock_alarm`(대리 신호) | O |
| 아기/사람 위급 소리 | `crying_baby` | 부분 (scream/shout/groan 샘플은 ESC-50에 없음) |
| 출입/방문, 문/보안 | `door_wood_knock`, `door_wood_creaks` | O (단, doorbell/ding-dong 전용 샘플 없음) |
| 건강 이상 신호음 | `coughing`, `sneezing`, `snoring`, `breathing` | O — 4종 모두 있음 |
| 동물 소리 | `dog`, `cat`, `cow`, `hen`, `rooster`, `sheep`, `pig`, `frog`, `crow`, `chirping_birds`, `insects` | O (풍부) |
| 생활 소음(로그용) | `vacuum_cleaner`, `washing_machine`, `keyboard_typing`, `mouse_click`, `clapping`, `brushing_teeth`, `drinking_sipping`, `footsteps`, `laughing`, `can_opening`, `toilet_flush` | O (풍부) |
| 주방 위험 전조 | `pouring_water`, `water_drops` (약한 대리 신호) | 부족 — boiling/microwave 없음, 자체 샘플 추가 필요 |
| 정상음/배경 기준선(참고 A용) | `rain`, `sea_waves`, `wind`, `clock_tick`, `thunderstorm` | O |
| 장시간 무음/무활동 판정용 | `footsteps`(활동 신호), 무음 구간은 별도 합성 필요 | 부분 |

추가로 흥미로운 점: ESC-50에 **`crackling_fire`** (실제 불 타는 소리) 카테고리가 있음 —
참고 B가 지적한 "화재경보음이지 실제 불소리 아님" 한계를 보완할 수 있는 실제 화재음 샘플로
활용 가능. **확인 필요**: YAMNet 521클래스(`yamnet_class_map.csv`)에 이 실제 화재음에 대응하는
클래스(예: Fire, Crackle 계열)가 있는지 재확인 — 있다면 "화재 경보음 OR 실제 불소리" 조합으로
화재 감지 신뢰도를 높일 수 있음.

**부족한 부분** (자체 샘플 또는 다른 데이터셋 추가 수집 필요):
- Scream/Shout/Groan (낙상 의심 조합 신호)
- Doorbell/Ding-dong (초인종 전용음, 현재 `media/`에도 없음)
- Boiling/Microwave/Dishes (주방 위험 전조)
- 무음 구간 자체(활동 부재 판정용 — 합성으로 만들 수 있음, 별도 수집 불필요)

기존 `media/` 폴더 자체 수집 샘플(glass-break, baby-crying, door-knock, fire-alarm)은 ESC-50과
일부 겹치므로, 실제 마이크·가정용 기기 환경에 가까운 보조 검증셋으로 유지.

---

## 3-1. 디폴트 키워드 마스터 테이블 (`category_map.py` 초안 데이터)

> §2.2/§2.6/§2.7/§2.7.1에 흩어져 있던 카테고리를 하나의 마스터 테이블로 정리한 것. 원문에
> 위험도/locked 여부가 명시되지 않은 항목은 "(제안, 확인 필요)"로 표시 — 확정은 §9로 이관.

| # | category_id | 키워드 그룹 | 포함 클래스 (index) | default_risk_level | locked | 판정 방식 | ESC-50 커버리지 |
|---|---|---|---|---|---|---|---|
| 1 | `fire_alarm_siren` | 경보음/사이렌 | Fire alarm(394), Alarm(382), Siren(390), Smoke detector·smoke alarm(393) | 높음 | **O** | 클래스 조합 + 시간창 | O (`siren`, `clock_alarm` 대리) |
| 2 | `glass_impact` | 파손/충격음 | Glass(435), Shatter(437), Thump·thud(454), Crack(434), Breaking(464) | 높음 | O (제안, §2.6 "화재·유리 파손" 문구 근거) | 클래스 조합 + 시간창 (Glass+Shatter/Breaking 동시 상승) | O (`glass_breaking`) |
| 3 | `fall_suspect` | 낙상 의심 | Thump·thud(454) → Groan(33)/Screaming(11)/Shout(6) 순차 조합 | 높음 (확정) | 아니오 | 클래스 조합 + 시간창 (Thud→Scream 순서) | 없음 (thud/scream류 샘플 없음 — 자체 수집 필요) |
| 4 | `baby_person_distress` | 아기/사람 위급 소리 | Baby cry·infant cry(20), Crying·sobbing(19), Screaming(11), Shout(6), Groan(33) | 높음 (확정) | 아니오 | N-프레임 다수결 | 부분 (`crying_baby`만 O) |
| 5 | `door_visitor` | 출입/방문(초인종) | Doorbell(349), Ding-dong(350), Knock | 낮음 | 아니오 | 단일 임계값 | 부분 (`door_wood_knock` O, doorbell 없음) |
| 6 | `door_security` | 문/보안(확장) | Door(348), Slam(352), Knock(353) | 낮음 (제안, 확인 필요) | 아니오 | 단일 임계값 / 조합 | O (`door_wood_knock`, `door_wood_creaks`) |
| 7 | `long_silence` | 장시간 무음/무활동 | 클래스 아님 — Silence(494) + Speech/Walk·footsteps(48) 부재 메타규칙 | 중간 (제안, 확인 필요) | 아니오 | 메타 규칙 (지난 N시간 활동신호 부재) | 부분 (`footsteps`로 활동 기준선만) |
| 8 | `health_signal` | 건강 이상 신호음 | Cough(42), Sneeze(44), Snoring(38), Wheeze(37) | 정보성 (즉시 알림 없음, 빈도 집계 후 일일 브리핑) | 아니오 | 빈도 집계 | O (`coughing`,`sneezing`,`snoring`,`breathing`) |
| 9 | `kitchen_risk` | 주방 위험 전조 | Water tap·faucet(364), Boiling(450), Microwave oven(362), Dishes·pots·pans(358) | 중간 (확정) | 아니오 | 지속시간 기반 (예: 30분 이상 지속) | 부족 (`pouring_water` 약한 대리) |
| 10 | `animal` | 동물 소리 | Bark, Meow 등 | 낮음, 기본 OFF | 아니오 | 단일 임계값 | O (`dog`,`cat`,`cow`,`hen` 등 풍부) |
| 11 | `ambient_log` | 생활 소음(로그용) | TV, Music, Speech | 알림 대상 아님 (로그 전용, 오탐 디버깅용) | 아니오 | 로그 전용 | O (풍부) |

**기본 목록에서 제외(비추천)**: 외부 사이렌(구급차/소방차/경찰차/민방위 — Ambulance(318),
Police car(317), Fire engine(319), Civil defense siren(391)) — 실내 마이크 기준 길거리
통과음일 확률이 높아 오탐/노이즈만 늘어남. 디폴트 카테고리에 포함하지 않음.

**도입 우선순위** (§2.7.1 근거): 기본 6종(#1~5, `ambient_log`)은 §2.2/§2.4에서 이미 확정된
항목이라 최우선. 확장 후보는 `long_silence` > `door_security` > `health_signal` >
`kitchen_risk` 순(뒤로 갈수록 지속시간 로직 등 구현 공수 큼).

---

## 4. 통합 설계 방향 (참고 A + 참고 B)

핵심 판단: 홈톡이 감지하려는 이벤트는 대부분 **"이미 알고 있는" 위험 신호**(유리, 화재경보,
아기 울음, 초인종, 기침/코골이 등)이므로, **참고 B의 직접 클래스 매핑 + 임계값/조합 규칙을
메인 로직으로 채택**한다. 참고 A의 delta 기반 novelty detection은 "알려진 카테고리에 없는
전혀 새로운 이상음"을 놓치지 않기 위한 **후순위 보조 안전망**으로 백로그에 둔다(참고 A 실험
자체가 recall 45.8%로 메인으로 쓰기엔 부족했던 것과 일치하는 결론).

```
16kHz mono 오디오 (마이크 스트림 또는 캡처된 클립)
        │
        ▼
  YAMNet 추론 (0.96초 window, 0.48초 hop)
        │  scores(521) [+ embedding(1024), 참고 A용으로 보관만]
        ▼
┌───────────────────────────────────────────────┐
│ 메인 로직 — 키워드 그룹 매칭 (참고 B §2.2~2.7)     │
│  - 카테고리별 관련 class index 점수 추출           │
│  - 후처리 규칙 적용 (§2.3): 단일 임계값 / N-프레임   │
│    다수결 / 클래스 조합+시간창                      │
│  - locked 카테고리(화재/파손)는 default 위험도 강제  │
└───────────────────────────────────────────────┘
        │ 카테고리 alert 발생
        ▼
┌───────────────────────────────────────────────┐
│ 알림 정책 (참고 B §2.4)                          │
│  - 위험도별 알림 방식 분기, 쿨다운 적용             │
└───────────────────────────────────────────────┘
        │
        ▼
  이벤트 payload 생성 (category_id, 위험도, top-5 원본 스코어 등)
        │
        ▼ (별도 작업 — homecare 백엔드)
  POST /api/events 등으로 전송, DB 저장, UI 알림

[백로그 — 참고 A 보조 안전망]
  score/embedding delta 기반 novelty detector를
  메인 로직과 병렬로 돌려서, 어떤 키워드 그룹에도 안 걸렸는데
  delta가 튀는 구간을 "미분류 이상음"으로 별도 로깅
  (알림까지는 안 보내고 우선 로그만 — 오탐 22.5건/시간 수준이라 알림 트리거로 쓰기엔 이름)
```

---

## 5. 폴더 구조 (현재 + 계획)

```
homecare/yamnet/          # 2026-09-04부로 homecare 저장소 하위로 이동 (git mv)
├── 참고.md              # 참고 A 원본 (수정 안 함)
├── Plan.md              # 이 문서
├── README.md            # 기존 mediatest.py 설명서
├── mediatest.py         # 기존: 폴더 내 파일 일괄 분류 (라벨링만 수행, 참고용/레거시)
├── media/               # 자체 수집 샘플 (glass-break, baby-crying, door-knock, fire-alarm)
├── ESC-50/              # clone 완료: 평가/기준선 데이터셋
│   ├── audio/           # 2000개 wav
│   └── meta/esc50.csv   # filename, fold, target, category 매핑
├── yamnet_class_map.csv # 완료: 공식 class map 저장본 (오프라인 index 검증용)
├── category_map.py      # 완료: 키워드 그룹 ↔ YAMNet class index 매핑 (검증 스크립트 포함)
│
# 앞으로 추가할 것들
├── event_rules.py        # (신규) 후처리 규칙: 임계값 / N-프레임 다수결 / 클래스 조합+시간창 (§2.3)
├── notification_policy.py # (신규) 위험도별 알림 방식 + 쿨다운 로직 (§2.4)
├── evaluate.py           # (신규) ESC-50 fold 기반으로 카테고리별 precision/recall 측정,
│                         #        참고 A 방식(fold 1~3/4/5 분리)도 재사용
├── novelty_detector.py   # (신규, 백로그) 참고 A: score/embedding delta 계산 — 보조 안전망용
└── stream_pipeline.py    # (신규) 오디오 입력 → 메인 로직 → (선택) 백로그 novelty 로그
                          #        → 이벤트 payload 출력까지 연결하는 엔드투엔드 스크립트
```

---

## 6. 구현 단계 (TODO, 우선순위 재조정)

- [ ] **1단계 — 기반 함수 분리**: `mediatest.py`의 로드/전처리/추론 로직을 재사용 가능한
      함수로 분리 (`load_yamnet()`, `preprocess(audio, sr)`, `infer(model, audio)` → scores,
      embedding 반환)
- [x] **2단계 — `category_map.py` 작성** (2026-09-04 완료): §3-1 마스터 테이블을 `SoundCategory`
      dataclass 리스트로 코드화, `yamnet_class_map.csv`로 전체 index 검증 완료.
      **검증 중 오류 발견 및 수정**: 원문의 Glass index `35`는 실제로 "Whistling"이었음 —
      정답은 `435`로 §3-1과 함께 정정. 추가로 `Smoke detector, smoke alarm(393)`을
      `fire_alarm_siren`에, `Breaking(464)`을 `glass_impact`에 보강 추가.
- [x] **3단계 — `event_rules.py` 작성** (2026-09-04 완료): §2.3 후처리 규칙을
      category_map.py의 7가지 rule_type(threshold/majority_vote/combo_window의 2변형
      combo_cooccurrence·combo_sequential/duration/frequency_count/meta_absence/log_only)에
      맞춰 각각 함수로 구현. `CATEGORY_RULE_CONFIG`로 SOUND_CATEGORIES 11개 전부 배정 완료,
      합성 데이터 기반 자체 테스트(`python3 event_rules.py`)로 7개 rule_type 전부 검증.
      **설계 시 결정한 세부사항** (Plan.md 원문에 없던 것): `glass_impact`는 Glass/Crack
      그룹과 Shatter/Breaking 그룹이 window_frames=3 안에서 모두 있어야 트리거(combo
      cooccurrence, min_groups=2), `fall_suspect`는 Thud 이후 window_frames=6 이내에
      Groan/Screaming/Shout가 순서대로 뒤따라야 트리거(combo sequential), `fire_alarm_siren`은
      locked+즉시알림 정책에 맞춰 단일 클래스만 넘어도 트리거(min_groups=1)하되 다중 클래스
      동시 상승은 참고 정보로만 남김. threshold/window 수치는 전부 placeholder — 4단계
      evaluate.py에서 ESC-50 fold 4로 실측 튜닝 필요 (미확정 상태 유지, §9에 추가 예정).
- [ ] **4단계 — 평가 데이터 준비 및 검증(`evaluate.py`)**: §3 매칭표 기준으로 ESC-50에서
      카테고리별 clip 추출 → fold 1~3(임계값 튜닝용 정상 기준선), fold 4(임계값 결정),
      fold 5(최종 precision/recall 평가)로 분리해 카테고리별 성능 측정
- [ ] **5단계 — `notification_policy.py`**: §2.4 위험도별 알림 방식 + 쿨다운 구현
      (locked 카테고리는 "완전 무음" 설정 자체를 막는 가드 포함)
- [ ] **6단계 — 엔드투엔드 파이프라인(`stream_pipeline.py`)**: 파일/스트림 입력 → 메인 로직 →
      알림 정책 → 이벤트 payload(JSON) 출력까지 연결
- [ ] **7단계 — 라즈베리파이 실측**: 처리 속도(RTF)와 전력 소비를 라즈베리파이에서 직접 측정
- [ ] **8단계 (백로그) — `novelty_detector.py`**: 참고 A의 delta 기반 이상 탐지를 보조
      안전망으로 추가 (알림 트리거 아님, 로그 전용으로 시작)
- [ ] **9단계 (이후 별도 작업, homecare 백엔드) — 연동**: `stream_pipeline.py` 출력 payload를
      기존 `POST /api/events`(X-Device-Id/X-Device-Secret 인증, multipart)로 전송,
      `sound_categories`/`user_category_settings` 테이블 설계는 백엔드 쪽에서 진행

---

## 7. 사용자 커스터마이징 — UI 참고 메모 (백엔드 작업, 여기서는 참고만)

> 아래는 오디오 파이프라인 자체 구현 범위가 아니라 homecare 백엔드/프론트엔드에서 다뤄야
> 할 사항이라 **참고용으로만 기록**한다. 실제 스키마·API 설계는 백엔드 작업 시 별도 진행.

- 위험도는 §2.6의 `default_risk_level`을 기본값으로 두고, 사용자가 **UI에서 키워드(카테고리)
  칩을 위험도 그룹 간에 드래그해서 옮기는 방식**으로 override할 수 있게 하자는 아이디어
  (예: "동물 소리" 카테고리를 기본 "낮음"에서 사용자가 "중간"으로 드래그 이동).
- 이는 §2.6 `user_category_settings.risk_level` override 필드로 이미 스키마 상 표현 가능 —
  드래그 UI는 이 값을 갱신하는 프론트엔드 인터랙션이 되는 셈.
- 단, §2.6에 명시된 안전장치(`locked=true` 카테고리는 완전 무음 불가)는 드래그로 이동하더라도
  최소 인앱 알림 이하로는 못 내려가게 막아야 함 — UI 드래그가 이 제약을 우회하지 않도록
  프론트/백엔드 양쪽에서 검증 필요.
- **확인 필요(백엔드 설계 시)**: 드래그로 "위험도 그룹"을 옮기는 것과, 개별 `notify_method`/
  `cooldown_minutes`를 따로 조절하는 UI를 분리할지 통합할지 — 참고 B §2.6의 A안(위험도 자체
  재정의)과 C안(민감도 3단계)을 드래그 인터랙션 하나로 합쳐서 보여줄 수 있는지는 프론트 UX
  설계 시 결정.

---

## 8. 알려진 한계 (설계 시 반드시 감안)

- 참고 A 기반 novelty detection은 recall 45.8% 수준 — 백로그 취급, 메인 안전 감시 수단 아님.
- 참고 B의 클래스 매핑도 만능은 아님: **낙상, 가스레인지 전용 AudioSet 클래스가 존재하지
  않음** — 오디오만으로 커버 불가, 카메라·가속도계·가스 센서 등 타 센서 결합 필수.
- YAMNet top label 신뢰도가 낮으므로, 카테고리 매칭 alert가 떠도 top label 자체는 "확정된
  사실"이 아니라 "참고 설명"으로만 이벤트에 담는다 (`metadata`에 원본 top-5 스코어 보존).
- 작은 음량(-10dB)일수록 탐지율 급락 — 마이크 배치/거리에 따라 실사용 성능이 실험 수치보다
  나쁠 수 있음.
- ESC-50에 없는 카테고리(scream/shout, doorbell, boiling/microwave 등)는 별도 샘플 수집 필요.
- ESC-50 라이선스(CC BY-NC 3.0)는 비영리 조건 포함 — 상용 배포 전 확인 필요.
  (YAMNet/TensorFlow Models 자체는 Apache 2.0으로 별개.)

---

## 9. 확인 필요 (미확정, 통합)

- **§3-1 마스터 테이블 잔여 미확정 항목**: `glass_impact`의 `locked` 여부, `door_security`/
  `long_silence`의 default_risk_level (나머지 `fall_suspect`=높음, `baby_person_distress`=높음,
  `kitchen_risk`=중간은 2026-09-04 확정됨)
- 실제 타겟 하드웨어(라즈베리파이)에서 YAMNet 실시간 처리 지연/전력 소비 벤치마크
- Fire alarm/Alarm 클래스의 실제 가정용 화재경보기 소리 리콜 — 실측 테스트 필요
- ~~ESC-50 `crackling_fire`에 대응하는 YAMNet 클래스(실제 불소리) 존재 여부~~ → **해결**:
  `yamnet_class_map.csv` 직접 대조 결과 `Fire`(292), `Crackle`(293) 클래스 존재 확인. 화재 경보음
  (`fire_alarm_siren`)과 별개로 실제 불소리 보조 신호로 추가할지는 아직 미채택 (§3-1 반영 안 됨)
- Doorbell/Ding-dong, Scream/Shout, 주방 위험음(Boiling/Microwave) 샘플 추가 수집처 결정
- `animal` 카테고리의 "기본 OFF"를 `sound_categories`/`user_category_settings` 스키마 중 어디서
  표현할지 — 마스터 스키마(§2.6)에는 `enabled` 필드가 없음 (`category_map.py` 구현 중 발견,
  백엔드 스키마 설계 시 확인 필요)
- **`event_rules.py`의 threshold/window_frames/min_duration_sec 등 전부 placeholder** —
  ESC-50 fold 4(정상음, §3-1)로 카테고리별 오탐 0건 기준 실측 튜닝 필요 (4단계 evaluate.py에서
  수행). 특히 `glass_impact`의 그룹 분할(Glass·Crack vs Shatter·Breaking)과 `fall_suspect`의
  순차 window_frames=6은 실제 ESC-50 `glass_breaking`/합성 낙상 스트림으로 검증된 적 없음.

---

## 10. 참고 링크
- https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/README.md
- https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/yamnet_class_map.csv
- https://github.com/karolpiczak/ESC-50 (clone 완료, `ESC-50/` 폴더)

---

## 11. 다음 액션

**2단계(`category_map.py`)부터 시작**하는 것을 제안. 이유: 참고 B의 키워드 그룹 매핑이 이미
구체적으로 정리돼 있고, ESC-50에서 대부분 카테고리(§3)를 바로 검증할 수 있는 샘플을 확보한
상태라 가장 빠르게 실측 가능한 단계이기 때문. 참고 A의 novelty detector는 8단계 백로그로
미룸. 순서·우선순위에 이견 있으면 조정.
