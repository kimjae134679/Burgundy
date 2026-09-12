# Burgundy Online

브라우저에서 플레이하는 《The Castles of Burgundy》 계열 규칙 검증형 프로토타입입니다.

## 목표

- 실제 규칙을 기준으로 한 게임 엔진
- `Room + Seats` 하나의 모델로 1인(사람 + AI), AI 채우기, 친구 초대, 온라인 멀티를 모두 처리
- AI와 사람 플레이어가 **동일한 합법 행동 판정/상태 전이 코드**를 사용
- 서버가 최종 게임 상태를 소유하는 server-authoritative 온라인 구조
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

초기 골격 단계입니다.

- [x] 프로젝트 방향/규칙 기준 고정
- [x] Room/Seat 모델 초안
- [x] 공용 TypeScript game-core 시작
- [x] 웹 로비/테이블 프로토타입 시작
- [ ] base game 한 판 완주 가능한 룰 엔진
- [ ] AI
- [ ] 실시간 room server
- [ ] 초대/재접속/저장
- [ ] 배포

## 실행

```bash
npm install
npm run dev
```

기본 웹 앱은 `apps/web`, 순수 게임 규칙 코드는 `packages/game-core`에 둡니다.

## 저장소 원칙

생성된 UI 도안 이미지는 레이아웃/분위기 참고용입니다. 규칙, 보드 구조, 타일 효과와 점수 계산은 실제 룰 자료를 우선합니다.

공식 로고/일러스트/룰북 문구를 그대로 복제하지 않고 프로토타입용 독자 UI를 사용합니다. 이 저장소는 원작 제작사/퍼블리셔와 무관한 개발 프로토타입입니다.
