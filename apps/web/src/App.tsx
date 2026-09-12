import { useMemo, useState } from 'react';
import {
  addAi,
  canStartRoom,
  createRoom,
  createSoloVsAiRoom,
  removeAi,
  startRoom,
  type PlayerCount,
  type RoomState,
} from '@burgundy/game-core';

const HOST_ID = 'local-human';
const HOST_NAME = 'You';

const depotTiles = [
  ['building', 'ship', 'animal'],
  ['mine', 'building', 'monastery'],
  ['animal', 'ship', 'building'],
  ['monastery', 'mine', 'animal'],
  ['ship', 'building', 'monastery'],
  ['castle', 'mine', 'building'],
] as const;

const estateRows = [4, 5, 6, 7, 6, 5, 4];
const estateFamilies = [
  'animal', 'building', 'monastery', 'mine',
  'ship', 'animal', 'building', 'monastery', 'mine',
  'building', 'ship', 'animal', 'building', 'monastery', 'mine',
  'ship', 'building', 'animal', 'castle', 'building', 'monastery', 'ship',
  'mine', 'building', 'animal', 'ship', 'building', 'monastery',
  'animal', 'ship', 'building', 'mine', 'monastery',
  'building', 'animal', 'ship', 'mine',
] as const;

function newRoom(maxPlayers: PlayerCount): RoomState {
  return createRoom({
    code: 'B7K3Q',
    hostPlayerId: HOST_ID,
    hostDisplayName: HOST_NAME,
    maxPlayers,
  });
}

function Lobby({ room, setRoom }: { room: RoomState; setRoom: (room: RoomState) => void }) {
  const occupied = room.seats.filter((seat) => seat.kind !== 'empty').length;

  const copyInvite = async () => {
    const url = `${window.location.origin}/?room=${room.code}`;
    await navigator.clipboard?.writeText(url);
  };

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">rules-first web prototype</p>
          <h1>Burgundy Online</h1>
        </div>
        <div className="room-code">Room <strong>{room.code}</strong></div>
      </header>

      <section className="hero-grid">
        <div className="panel intro-panel">
          <p className="eyebrow">Play mode</p>
          <h2>하나의 방에서 사람과 AI를 자유롭게 구성</h2>
          <p className="muted">
            1인 버튼도 별도 게임이 아니라 일반 2~4인 base game 방을 만들고 빈 자리를 AI로 채우는 구조입니다.
          </p>

          <div className="mode-buttons">
            <button
              className="primary"
              onClick={() =>
                setRoom(
                  createSoloVsAiRoom({
                    code: 'SOLO1',
                    hostPlayerId: HOST_ID,
                    hostDisplayName: HOST_NAME,
                    totalPlayers: 2,
                  }),
                )
              }
            >
              사람 1 + AI 1
            </button>
            <button onClick={() => setRoom(newRoom(room.maxPlayers))}>새 방</button>
            <button onClick={copyInvite}>초대 링크 복사</button>
          </div>

          <div className="player-count">
            <span>총 플레이 인원</span>
            {[2, 3, 4].map((count) => (
              <button
                key={count}
                className={room.maxPlayers === count ? 'selected' : ''}
                onClick={() => setRoom(newRoom(count as PlayerCount))}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        <div className="panel seats-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Seats</p>
              <h2>{occupied} / {room.maxPlayers}</h2>
            </div>
            <button onClick={() => setRoom(addAi(room))}>+ AI 추가</button>
          </div>

          <div className="seat-list">
            {room.seats.map((seat, index) => (
              <div className={`seat seat-${seat.kind}`} key={index}>
                <div className="seat-index">{index + 1}</div>
                <div className="seat-copy">
                  <strong>
                    {seat.kind === 'empty' ? '빈 자리' : seat.displayName}
                  </strong>
                  <span>
                    {seat.kind === 'human' && (index === 0 ? '방장 · Human' : 'Human')}
                    {seat.kind === 'ai' && `AI · ${seat.difficulty}`}
                    {seat.kind === 'empty' && '친구 입장 또는 AI 추가'}
                  </span>
                </div>
                {seat.kind === 'ai' && (
                  <button className="quiet" onClick={() => setRoom(removeAi(room, index))}>
                    제거
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            className="start-button"
            disabled={!canStartRoom(room)}
            onClick={() => setRoom(startRoom(room))}
          >
            게임 시작
          </button>
          {!canStartRoom(room) && <p className="hint">빈 자리를 사람 또는 AI로 모두 채우면 시작할 수 있습니다.</p>}
        </div>
      </section>

      <section className="panel accuracy-note">
        <div>
          <p className="eyebrow">Implementation order</p>
          <strong>실제 규칙 → 룰 엔진 → AI/멀티 → 시각 요소</strong>
        </div>
        <p className="muted">
          중앙 1~6 depot, black depot, goods, phase/round, turn order, 개인 duchy와 3칸 tile storage를 실제 규칙 구조로 맞추는 중입니다.
        </p>
      </section>
    </main>
  );
}

function TileChip({ family }: { family: string }) {
  return <span className={`hex mini family-${family}`} title={family} />;
}

function Depot({ number, tiles }: { number: number; tiles: readonly string[] }) {
  return (
    <div className="depot">
      <div className="depot-number">{number}</div>
      <div className="depot-tiles">
        {tiles.map((tile, i) => <TileChip key={`${tile}-${i}`} family={tile} />)}
      </div>
      <div className="goods-slot">goods</div>
    </div>
  );
}

function EstateBoard() {
  let cursor = 0;
  return (
    <div className="estate-wrap">
      <div className="estate-title">
        <strong>Your Duchy</strong>
        <span>board #1 geometry/data pass in progress</span>
      </div>
      <div className="estate-grid">
        {estateRows.map((count, rowIndex) => {
          const cells = estateFamilies.slice(cursor, cursor + count);
          cursor += count;
          return (
            <div className="estate-row" key={rowIndex}>
              {cells.map((family, colIndex) => {
                const isCenter = rowIndex === 3 && colIndex === 3;
                return (
                  <div
                    key={`${rowIndex}-${colIndex}`}
                    className={`hex estate-hex family-${family} ${isCenter ? 'occupied' : ''}`}
                  >
                    <span>{isCenter ? 'C' : ((rowIndex + colIndex) % 6) + 1}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GameTable({ room, setRoom }: { room: RoomState; setRoom: (room: RoomState) => void }) {
  const players = room.seats.filter((seat) => seat.kind !== 'empty');

  return (
    <main className="game-shell">
      <header className="game-header">
        <div>
          <p className="eyebrow">Special Edition base · prototype state</p>
          <h1>Burgundy Online</h1>
        </div>
        <div className="game-meta">
          <span>Room {room.code}</span>
          <span>Phase A</span>
          <span>Round 1 / 5</span>
          <button onClick={() => setRoom(newRoom(room.maxPlayers))}>로비로</button>
        </div>
      </header>

      <div className="table-layout">
        <aside className="players-rail">
          {players.map((seat, index) => (
            <div className={`player-card ${index === 0 ? 'active' : ''}`} key={index}>
              <div>
                <strong>{seat.kind === 'human' ? seat.displayName : seat.displayName}</strong>
                <span>{index === 0 ? '현재 턴' : seat.kind === 'ai' ? seat.difficulty : 'Human'}</span>
              </div>
              <div className="score">0 VP</div>
              <div className="dice"><i>2</i><i>5</i></div>
              <div className="resource-line">workers 1 · silver 1</div>
            </div>
          ))}
        </aside>

        <section className="common-board panel">
          <div className="phase-track">
            {['A', 'B', 'C', 'D', 'E'].map((phase, index) => (
              <span className={index === 0 ? 'current' : ''} key={phase}>{phase}<small>{10 - index * 2}</small></span>
            ))}
          </div>

          <div className="depot-grid">
            {depotTiles.map((tiles, index) => (
              <Depot key={index} number={index + 1} tiles={tiles} />
            ))}
            <div className="black-depot">
              <span>BLACK DEPOT</span>
              <div><TileChip family="building" /><TileChip family="ship" /></div>
              <small>2 silverlings · once per turn</small>
            </div>
          </div>

          <div className="board-footer">
            <div><strong>White die</strong><span className="die-large">4</span></div>
            <div><strong>Goods round queue</strong><span>▰ ▰ ▰ ▰ ▰</span></div>
            <div><strong>Turn order</strong><span>① You ② AI</span></div>
          </div>
        </section>

        <aside className="turn-panel panel">
          <p className="eyebrow">Your turn</p>
          <h2>Dice 2 · 5</h2>
          <div className="action-stack">
            <button>Take a hex tile</button>
            <button>Place a hex tile</button>
            <button>Sell goods</button>
            <button>Take 2 workers</button>
          </div>
          <div className="turn-resources">
            <span>Workers <strong>1</strong></span>
            <span>Silverlings <strong>1</strong></span>
          </div>
          <p className="hint">현재는 테이블 구조 vertical slice. 다음 단계에서 legal-action engine에 연결합니다.</p>
        </aside>

        <section className="player-board panel">
          <div className="storage-column">
            <h3>Tile storage</h3>
            <div className="storage-slots"><TileChip family="building" /><span className="hex mini empty-hex" /><span className="hex mini empty-hex" /></div>
            <h3>Goods</h3>
            <div className="goods-stacks"><span>1 × 2</span><span>4 × 1</span><span>—</span></div>
          </div>
          <EstateBoard />
          <div className="rules-key">
            <h3>Tile families</h3>
            {['castle', 'mine', 'ship', 'animal', 'building', 'monastery'].map((family) => (
              <div key={family}><TileChip family={family} /><span>{family}</span></div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

export function App() {
  const initialRoom = useMemo(() => newRoom(4), []);
  const [room, setRoom] = useState<RoomState>(initialRoom);

  return room.started ? <GameTable room={room} setRoom={setRoom} /> : <Lobby room={room} setRoom={setRoom} />;
}
