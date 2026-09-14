# Burgundy Online

브라우저에서 플레이하는 《The Castles of Burgundy》 계열 규칙 검증형 프로토타입입니다.

## 이번 UI/멀티 개선에서 바뀐 것

- **내 주사위를 항상 보이는 위치에 크게 표시**하고, 선택/사용 완료 상태를 구분합니다.
- 턴 조작을 `주사위 선택 → 행동 선택 → 대상/확정` 3단계로 고정해 현재 해야 할 일을 바로 알 수 있게 했습니다.
- 플레이어 카드에 현재 턴, 행동 1/2·2/2, 남은 주사위, 점수, 일꾼/은화/보관/상품 수를 표시합니다.
- 우측 최근 행동 로그에 확정된 행동을 실시간으로 쌓습니다.
- 작은 고정 칸에 긴 문구를 억지로 넣는 구조를 없애고 반응형 grid/flex + 줄바꿈 + 패널 스크롤 구조로 바꿨습니다.
- 대기실을 **스타크래프트식 슬롯 중심 구조**로 바꿨습니다. 방장은 각 자리를 `열림 / 사람 / AI / 잠금`으로 직접 바꿀 수 있고, AI 난이도/색/영지판도 자리별로 설정합니다.
- 사용하지 않는 자리는 잠그면 2~4인 모두 같은 4슬롯 로비에서 시작할 수 있습니다.
- Cloudflare Durable Objects 기반 **상시 Room Server**를 추가했습니다. 별도 사용자 PC가 켜져 있을 필요 없이 방 생성/참가/재접속/호스트 승계/진행 단계/행동 로그를 WebSocket으로 동기화할 수 있습니다.

## 목표

- 실제 규칙을 기준으로 한 게임 엔진
- `Room + Seats` 하나의 모델로 1인(사람 + AI), AI 채우기, 친구 초대, 온라인 멀티를 모두 처리
- AI와 사람 플레이어가 **동일한 합법 행동 판정/상태 전이 코드**를 사용
- 서버가 room/presence를 소유하고, 최종적으로 게임 상태까지 server-authoritative로 확장
- PC/모바일 브라우저 대응

## 기준 규칙

첫 구현 기준은 **The Castles of Burgundy: Special Edition의 base game**입니다. 확장/공식 Solo/Chateauma는 별도 ruleset으로 분리하여 이후 추가합니다.

공식 기준 자료:
- Awaken Realms Castles of Burgundy downloads: https://awakenrealms.com/download
- Special Edition rulebook PDF: https://awakenrealms.com/images/download/CoB/CoB_Rulebook_285x210mm%20%5B28%20pages%5D.pdf

교차 검증 자료:
- Board Game Arena game help: https://en.doc.boardgamearena.com/Gamehelpcastlesofburgundy
- UltraBoardGames rules reference: https://www.ultraboardgames.com/castles-of-burgundy/game-rules.php

세부 기준은 `docs/RULES_BASELINE.md`에 기록합니다.

## 현재 상태

- [x] 프로젝트 방향/규칙 기준 고정
- [x] Room/Seat 모델
- [x] 사람/AI/열림/잠금 슬롯 UI
- [x] 플레이어 진행 단계/최근 행동 표시
- [x] 반응형 테이블 레이아웃
- [x] Durable Object 기반 room/presence WebSocket 서버
- [ ] base game 한 판 완주 가능한 룰 엔진
- [ ] 실제 AI 의사결정 엔진
- [ ] 모든 합법 행동을 서버에서 검증하는 완전한 server-authoritative game state
- [ ] 최종 공개 배포/도메인 연결

## 웹 실행

```bash
npm install
npm run dev
```

웹 앱은 `apps/web`, 순수 게임 규칙 코드는 `packages/game-core`에 둡니다.

## 온라인 Room Server

서버 코드는 `apps/server`에 있습니다. Cloudflare Workers + Durable Objects 구조라 게임을 만든 사람의 PC가 서버 역할을 하지 않습니다.

```bash
npm run server:dev
npm run server:deploy
```

배포된 Worker 주소를 웹 빌드의 환경변수에 넣습니다.

```bash
VITE_ROOM_SERVER_URL=https://burgundy-room-server.<account>.workers.dev
```

그 뒤 웹 앱을 다시 빌드하면 같은 `?room=XXXXXX` 링크로 접속한 브라우저들이 같은 방 상태를 공유합니다.

### 현재 서버가 동기화하는 것

- 방/슬롯 상태
- 온라인 참가자와 연결 상태
- 새 참가자의 빈 슬롯 자동 배치
- 재접속 시 기존 자리 복구
- 호스트 이탈 시 연결된 사람에게 방장 자동 승계
- 플레이어별 현재 진행 단계
- 확정 행동 이벤트/최근 로그

현재 실제 게임 규칙의 합법성 판정은 아직 `game-core` 확장 단계입니다. 다음 단계에서는 클라이언트가 결과 상태를 보내는 방식이 아니라 **행동 명령만 서버에 보내고 서버가 game-core로 검증/적용**하도록 옮깁니다.

## 저장소 원칙

생성된 UI 도안 이미지는 레이아웃/분위기 참고용입니다. 규칙, 보드 구조, 타일 효과와 점수 계산은 실제 룰 자료를 우선합니다.

공식 로고/일러스트/룰북 문구를 그대로 복제하지 않고 프로토타입용 독자 UI를 사용합니다. 이 저장소는 원작 제작사/퍼블리셔와 무관한 개발 프로토타입입니다.
