# Architecture

## Core principle

게임 규칙을 UI, AI, 네트워크에서 분리한다.

```text
apps/web
   ↓ commands
packages/game-core
   ↑ state/events

future apps/server
   ↓ validates the same commands
packages/game-core
```

## Room model

모든 모드는 동일 모델을 사용한다.

```ts
Room {
  code
  visibility
  seats: [
    { kind: 'human' | 'ai' | 'empty' }
  ]
  gameState?
}
```

- `Play Solo`: 비공개 room을 만들고 human 1 + AI N으로 채우는 shortcut
- `Add AI`: empty seat를 AI로 교체
- `Invite`: 초대 URL이 같은 room code로 join
- 사람 입장 시 AI 교체는 room option으로 처리
- 시작 후 연결 종료는 seat ownership과 connection state를 분리하여 처리

## game-core

framework-independent TypeScript.

책임:
- ruleset data
- room/seat transitions
- game state
- legal action generation
- command validation
- state transition
- scoring
- deterministic RNG hooks
- event log

금지:
- DOM
- React state
- WebSocket
- database access

## Web client

React + Vite.

초기에는 local state로 lobby/table UX를 검증하고, server 연결 후에는 server snapshot을 렌더링하는 thin client로 바꾼다.

## Server — planned

실시간 방 서버는 server-authoritative로 구성한다.

클라이언트는 다음만 전송한다.

```text
intent: USE_DIE
intent: TAKE_TILE
intent: PLACE_TILE
...
```

서버가:
- 현재 turn 확인
- die 사용 가능 확인
- action 합법성 확인
- RNG 처리
- state 변경
- 모든 참가자에게 snapshot/event broadcast

이를 통해 클라이언트 조작/동기화 충돌을 줄인다.

## Persistence — planned

영구 저장 대상:
- 계정/닉네임
- room metadata
- active game snapshot
- event/replay log
- 전적

실제 DB 제품 선택은 온라인 vertical slice 이후 확정한다.

## Replay/debugging

모든 game mutation은 command/event로 남기는 방향을 기본으로 한다.

```text
seed + initial config + ordered commands = reproducible game
```

버그가 발생하면 실제 판을 재현할 수 있어야 한다.
