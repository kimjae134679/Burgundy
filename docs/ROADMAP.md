# Burgundy Online — Roadmap

## 0. 규칙 기준 고정

목표: 구현 전에 판본 차이와 규칙 오해를 코드에 박아 넣지 않는다.

- Special Edition base game을 최초 baseline으로 고정
- 실제 중앙 보드의 역할을 데이터 모델로 분리: 1~6 depots / central black depot / goods / round & phase / turn order / VP track / color bonus
- 실제 개인 보드의 역할을 데이터 모델로 분리: estate hex map / 3 tile storage / 3 goods types / sold goods / dice / workers / silverlings
- 건물 8종, ship, animal, castle, mine, monastery(knowledge) 효과 목록화
- 판본 차이는 ruleset 버전으로 분리

완료 기준: `RULES_BASELINE.md`와 테스트 항목이 서로 대응한다.

## 1. 순수 룰 엔진

UI/네트워크와 분리된 TypeScript 상태 머신을 만든다.

- seeded RNG
- phase A-E, 각 5 rounds
- 주사위 2개와 white die
- worker 보정
- 4개 기본 dice actions
- black depot 구매
- storage 3칸
- estate 배치 합법성
- 타일 배치 즉시 효과
- 영역 완성 및 색 완성 bonus
- phase 종료 처리
- final scoring / tie-break

완료 기준: headless 테스트만으로 2~4인 게임을 처음부터 끝까지 진행할 수 있다.

## 2. 로컬 플레이 Vertical Slice

먼저 서버 없이 동일 기기에서 실제 한 판이 돌아가게 한다.

- 중앙 board UI
- 현재 플레이어 duchy
- 상대 board 요약/확대
- 합법 행동 highlight
- 주사위 선택 → 행동 → 결과 확인
- undo는 개발 모드에서만 제공
- turn/round/phase 진행
- 모바일 터치 대응

완료 기준: 사람 2명이 hot-seat로 base game 1판 완주.

## 3. AI

AI 역시 일반 플레이어와 동일한 legal-action API만 사용한다.

- Easy: 합법 행동 중 간단한 휴리스틱
- Normal: 즉시 점수 + 영역 완성 + 경제 + 다음 턴 유연성 평가
- Hard: 후보 수 제한 + lookahead/rollout
- AI 결정 로그는 개발 모드에서 확인 가능

추가 옵션:
- Special Edition 공식 Chateauma를 별도 모드로 구현
- 공식 Solo expansion도 별도 ruleset으로 구현

완료 기준: 사람 1 + AI 1~3명이 게임을 끝까지 진행하고 불법 행동이 발생하지 않는다.

## 4. Room / 온라인 멀티

모든 플레이 모드를 하나의 room model로 통합한다.

```text
Room
  seats[2..4]
    human | ai | empty
```

- 비공개/공개 방
- 초대 코드/URL
- 방장 권한
- AI 추가/제거
- 빈 자리 AI 채우기
- 사람이 들어올 때 AI 자리 교체 옵션
- reconnect
- 이탈 후 AI takeover 옵션

서버가 dice/RNG/game state의 유일한 권위자가 된다.

완료 기준: 서로 다른 브라우저 2개에서 동일 방 상태가 실시간 동기화.

## 5. 서버/저장/배포

권장 구조:

- Web: React + Vite
- Game core: framework-independent TypeScript
- Realtime room server: Cloudflare Workers + Durable Objects 계열 검토
- 계정/전적/저장 게임: Supabase 계열 검토

실제 서비스 비용/무료 티어/운영 복잡도를 확인한 뒤 최종 선택한다.

완료 기준: 개발 PC가 꺼져 있어도 URL 접속 → 방 생성 → 초대 → 게임 가능.

## 6. 정확도/QA

- 공식 규칙의 각 문단에 대응하는 테스트 작성
- 2/3/4인 공급량 차이 검증
- 건물/monastery 상호작용 회귀 테스트
- reconnect 중복 action 방지
- server-side action validation
- seeded replay 파일로 버그 재현
- 게임 로그에서 모든 점수 변화를 추적 가능하게 유지

## 우선순위

`규칙 정확도 > 게임 완주 > AI > 온라인 > 그래픽 polish`

생성 도안은 최종 규칙/보드 구조를 결정하는 자료로 사용하지 않는다.
