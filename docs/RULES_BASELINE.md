# Rules Baseline — Special Edition Base Game

이 문서는 구현 시 사용하는 규칙 기준이다. 생성 이미지나 UI mockup보다 이 문서와 원문 rulebook이 우선한다.

## Canonical source

- Awaken Realms — Castles of Burgundy downloads
  - https://awakenrealms.com/download
- The Castles of Burgundy: Special Edition rulebook PDF
  - https://awakenrealms.com/images/download/CoB/CoB_Rulebook_285x210mm%20%5B28%20pages%5D.pdf

## Cross-check sources

- Board Game Arena help
  - https://en.doc.boardgamearena.com/Gamehelpcastlesofburgundy
- UltraBoardGames rules reference
  - https://www.ultraboardgames.com/castles-of-burgundy/game-rules.php

## Target ruleset

첫 번째 완성 목표는 **Special Edition의 일반 base game 2~4인 규칙**이다.

`1인 플레이` 버튼의 최초 구현은 공식 Solo expansion이 아니라 **사람 1명 + AI 1~3명으로 일반 2~4인 게임을 만드는 단축 기능**이다. 공식 Solo expansion과 Chateauma는 별도 모드로 이후 구현한다.

## Game clock

- 5 phases: A, B, C, D, E
- 각 phase = 5 rounds
- 총 25 rounds
- 각 플레이어는 자기 turn에 두 개의 dice를 각각 한 번씩 사용하여 정확히 2개의 dice actions를 수행한다.
- start player는 white die도 굴린다. white die는 상품(goods) 이동에 사용되며 해당 플레이어의 일반 action die로 쓰지 않는다.

## Main board model

반드시 데이터로 구분한다.

- numbered depots 1~6
- central black depot
- 각 numbered depot의 goods space
- phase A~E
- current round 1~5
- turn order track
- victory-point track
- color-completion bonus tiles

플레이 인원수 2/3/4에 따라 사용하는 depot 공급 공간 수가 달라진다. 이 차이는 setup 테스트로 별도 검증한다.

## Player state

각 플레이어는 최소 다음 상태를 가진다.

- 2 dice
- workers
- silverlings
- victory points
- turn-order marker
- estate/duchy hex map
- hex-tile storage 3 spaces
- goods storage: 서로 다른 goods type 최대 3종
- sold goods
- claimed color bonus tiles
- placed monastery/knowledge effects

기본 board setup에서는 castle에서 시작하며, 정확한 시작 좌표/printed die number는 선택된 estate board 정의에 포함시킨다.

## Worker die adjustment

- worker 1개를 소비해 die result를 +1 또는 -1
- 1 ↔ 6 순환 가능
- 여러 worker를 연속 소비해 여러 칸 변경 가능
- white die는 worker로 변경할 수 없다.

## Four basic dice actions

### 1. Take a hex tile

- 사용한 die와 같은 번호의 numbered depot에서 hex tile 1개 선택
- 해당 tile은 반드시 먼저 개인의 3칸 storage로 이동
- estate에 직접 놓을 수 없음
- storage가 가득 찬 경우 기존 storage tile을 버리고 새 tile을 받을 수 있는 규칙을 정확히 반영한다.

### 2. Place a hex tile

storage의 tile 1개를 estate에 배치한다.

합법 조건:
- 배치 space의 printed die value가 사용 die result와 일치
- tile color/type과 space color가 일치
- 이미 놓인 자신의 tile에 인접해야 함
- 배치 후 tile은 이동/제거 불가

타일 종류에 따라 즉시 effect가 발생한다.

### 3. Sell goods

- die result와 일치하는 goods type을 선택
- 그 type의 goods는 일부만이 아니라 전부 판매
- 판매 action당 silverling을 획득
- 판매한 tile마다 player count에 따른 VP 획득

base 규칙의 기본 VP는 2인=2, 3인=3, 4인=4 VP per sold tile이다.

### 4. Take workers

- die value와 무관하게 workers 2개 획득

## Central black depot

일반 dice actions 두 번과 별도로, 한 turn에 한 번 central black depot의 tile 1개를 2 silverlings에 구매할 수 있다.

정확한 timing 및 monastery 효과와의 상호작용은 ruleset 함수로 관리한다.

## Tile families

### Castle — burgundy

배치 즉시 임의의 die result를 가진 것처럼 추가 action 1회.

### Mine — gray

배치 즉시 효과는 없고, phase 종료 시 놓인 mine마다 silverling 1개.

### Ship — blue

배치 즉시:
- numbered depot 하나를 골라 해당 goods를 획득(개인 goods type 3종 제한 적용)
- turn-order track 전진

### Animal — light green

배치한 pasture 안에서 같은 animal species의 기존 tile을 포함해 점수를 계산한다. 다른 pasture의 같은 animal은 포함하지 않는다.

### Building — beige

한 city 내 같은 building type 중복 제한이 기본 규칙이다(이를 변경하는 monastery 효과 존재).

base building 8종:
- Warehouse
- Carpenter's Workshop
- Church
- Market
- Boarding House
- Bank
- City Hall / Town Hall
- Watchtower

각 building의 placement bonus는 독립 effect handler로 구현한다.

### Monastery / Knowledge — yellow

다수의 지속 효과/규칙 변경/최종 점수 효과가 있으므로 번호별 effect를 data-driven하게 구현한다.

## Completed region scoring

하나의 연결된 같은 색 region을 모두 채우면 즉시 점수.

크기 점수:

| region size | VP |
|---:|---:|
| 1 | 1 |
| 2 | 3 |
| 3 | 6 |
| 4 | 10 |
| 5 | 15 |
| 6 | 21 |
| 7 | 28 |
| 8 | 36 |

phase 추가 점수:

| phase | VP |
|---|---:|
| A | 10 |
| B | 8 |
| C | 6 |
| D | 4 |
| E | 2 |

## Complete-all-of-one-color bonus

한 플레이어가 자기 estate에서 특정 색의 모든 space를 처음으로 채우면 large bonus, 두 번째면 small bonus를 즉시 획득한다.

- large: 2p=5 / 3p=6 / 4p=7 VP
- small: 2p=2 / 3p=3 / 4p=4 VP

## Phase end

5번째 round가 끝나면:
- mine income 처리
- phase-end monastery effects 처리
- 다음 phase board 공급 정리/보충
- 기존 depot goods는 규칙에 따라 남을 수 있으므로 hex supply와 goods supply를 같은 방식으로 초기화하면 안 된다.

## Final scoring

phase E 종료 후:
- unsold goods 1개당 1 VP
- silverling 1개당 1 VP
- workers 2개당 1 VP
- VP를 주는 monastery tiles 점수
- storage에 남은 미배치 hex tile은 점수 없음

Special Edition의 multiplayer tie-break 기준은 해당 판본 기준으로 고정한다. 구현 전 공식 rulebook 문구를 fixture에 기록하고 회귀 테스트를 둔다.

## Edition differences

다른 판본의 이름/효과/타이브레이커/특정 monastery 효과를 한 코드에 섞지 않는다.

예:
- 1st edition
- 2019 edition
- Special Edition
- Solo expansion
- Chateauma
- Vineyard 등 expansions

각각 별도 `RulesetId` 또는 expansion flags로 관리한다.

## Implementation rule

규칙을 UI event handler 안에 직접 쓰지 않는다.

모든 조작은 다음 흐름을 따른다.

```text
Command -> validate(command, state, ruleset)
        -> apply(command, state, ruleset)
        -> emitted effects/events
        -> new state
```

AI와 온라인 서버 역시 같은 `validate/apply` 경로만 사용한다.
