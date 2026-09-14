import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addAiToSeat,
  canStartRoom,
  closeSeat,
  createRoom,
  renameSeat,
  setAiDifficulty,
  setLocalHumanAtSeat,
  setSeatBoard,
  setSeatColor,
  setSeatOpen,
  startRoom,
  type AiDifficulty,
  type DiceActionKind,
  type DieValue,
  type PlayerColor,
  type PublicTurnProgress,
  type RoomSeat,
  type RoomState,
} from '@burgundy/game-core';
import { connectRoomSocket, sendSocket, type Presence, type RoomServerMessage } from './realtime';

const SERVER_URL = import.meta.env.VITE_ROOM_SERVER_URL?.trim() || '';
const COLORS: Array<{ id: PlayerColor; label: string }> = [
  { id: 'blue', label: '파랑' },
  { id: 'red', label: '빨강' },
  { id: 'green', label: '초록' },
  { id: 'gold', label: '금색' },
];
const ACTION_LABELS: Record<DiceActionKind, string> = {
  'take-tile': '중앙에서 타일 가져오기',
  'place-tile': '보관 타일을 영지에 배치',
  'sell-goods': '상품 판매',
  'take-workers': '일꾼 2개 받기',
};
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

type OccupiedSeat = Extract<RoomSeat, { kind: 'human' | 'ai' }>;
type NetworkStatus = 'local' | 'connecting' | 'online' | 'offline';
type Activity = { id: string; playerId: string; message: string; at: number };
type DiceState = { values: [DieValue, DieValue]; used: [boolean, boolean] };

function isOccupied(seat: RoomSeat): seat is OccupiedSeat {
  return seat.kind === 'human' || seat.kind === 'ai';
}

function randomRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function getPlayerId() {
  const key = 'burgundy-player-id';
  const previous = sessionStorage.getItem(key);
  if (previous) return previous;
  const next = crypto.randomUUID();
  sessionStorage.setItem(key, next);
  return next;
}

function defaultDice(index: number): DiceState {
  const first = ((index * 2 + 1) % 6 + 1) as DieValue;
  const second = ((index * 3 + 4) % 6 + 1) as DieValue;
  return { values: [first, second], used: [false, false] };
}

function makeRoom(code: string, playerId: string, name: string): RoomState {
  return createRoom({
    code,
    hostPlayerId: playerId,
    hostDisplayName: name,
    maxPlayers: 4,
  });
}

function colorLabel(color?: PlayerColor) {
  return COLORS.find((entry) => entry.id === color)?.label ?? '파랑';
}

function Lobby({
  room,
  updateRoom,
  localPlayerId,
  networkStatus,
  presence,
}: {
  room: RoomState;
  updateRoom: (room: RoomState) => void;
  localPlayerId: string;
  networkStatus: NetworkStatus;
  presence: Presence[];
}) {
  const isHost = room.hostPlayerId === localPlayerId || networkStatus === 'local';
  const occupied = room.seats.filter(isOccupied).length;
  const open = room.seats.filter((seat) => seat.kind !== 'closed').length;

  const copyInvite = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', room.code);
    await navigator.clipboard?.writeText(url.toString());
  };

  const setMode = (index: number, mode: 'empty' | 'human' | 'ai' | 'closed') => {
    if (!isHost || index === 0) return;
    if (mode === 'empty') updateRoom(setSeatOpen(room, index));
    if (mode === 'human') updateRoom(setLocalHumanAtSeat(room, index));
    if (mode === 'ai') updateRoom(addAiToSeat(room, index));
    if (mode === 'closed') updateRoom(closeSeat(room, index));
  };

  return (
    <main className="lobby-shell">
      <header className="lobby-head">
        <div>
          <p className="eyebrow">BURGUNDY ONLINE</p>
          <h1>게임 대기실</h1>
          <p className="muted compact">자리 자체에서 사람 / AI / 열림 / 잠금을 정합니다.</p>
        </div>
        <div className={`net-pill ${networkStatus}`}>
          <span className="net-dot" />
          {networkStatus === 'online' ? `온라인 · ${presence.length}명 연결` : networkStatus === 'connecting' ? '서버 연결 중' : networkStatus === 'offline' ? '서버 연결 끊김' : 'LOCAL'}
        </div>
      </header>

      <section className="lobby-grid">
        <div className="lobby-panel seats-lobby">
          <div className="panel-title-row">
            <div>
              <span className="section-kicker">PLAYERS</span>
              <h2>{occupied}명 참가 · {open}자리 열림</h2>
            </div>
            <div className="room-code-box">방 코드 <strong>{room.code}</strong></div>
          </div>

          <div className="slot-list">
            {room.seats.map((seat, index) => {
              const hostSeat = index === 0;
              const remoteHuman = seat.kind === 'human' && seat.playerId !== localPlayerId && !seat.playerId.startsWith('local-');
              return (
                <article className={`slot-card kind-${seat.kind}`} key={index}>
                  <div className="slot-avatar">{seat.kind === 'closed' ? '×' : seat.kind === 'ai' ? 'AI' : index + 1}</div>
                  <div className="slot-main">
                    <div className="slot-heading">
                      <strong>자리 {index + 1} · {seat.kind === 'closed' ? '닫힘' : seat.kind === 'empty' ? '접속 대기' : seat.displayName}</strong>
                      <span>{hostSeat ? '방장' : remoteHuman ? '온라인 사용자' : seat.kind === 'ai' ? `AI · ${seat.difficulty}` : seat.kind === 'human' ? '이 기기에서 조작' : seat.kind === 'empty' ? '친구 입장 가능' : '입장 불가'}</span>
                    </div>

                    {seat.kind !== 'closed' && (
                      <div className="slot-fields">
                        {seat.kind === 'human' ? (
                          <input
                            value={seat.displayName}
                            disabled={!isHost && seat.playerId !== localPlayerId}
                            onChange={(event) => updateRoom(renameSeat(room, index, event.target.value))}
                            aria-label={`자리 ${index + 1} 이름`}
                          />
                        ) : (
                          <div className="field-readonly">{seat.kind === 'ai' ? seat.displayName : '빈 자리'}</div>
                        )}
                        {seat.kind === 'ai' ? (
                          <select
                            value={seat.difficulty}
                            disabled={!isHost}
                            onChange={(event) => updateRoom(setAiDifficulty(room, index, event.target.value as AiDifficulty))}
                          >
                            <option value="easy">쉬움</option>
                            <option value="normal">보통</option>
                            <option value="hard">어려움</option>
                          </select>
                        ) : <div className="field-readonly">{seat.kind === 'empty' ? '입장 대기' : '사람'}</div>}
                        <select
                          value={seat.color ?? 'blue'}
                          disabled={!isHost}
                          onChange={(event) => updateRoom(setSeatColor(room, index, event.target.value as PlayerColor))}
                        >
                          {COLORS.map((color) => <option key={color.id} value={color.id}>{color.label}</option>)}
                        </select>
                        <select
                          value={seat.board ?? 1}
                          disabled={!isHost}
                          onChange={(event) => updateRoom(setSeatBoard(room, index, Number(event.target.value)))}
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((board) => <option key={board} value={board}>영지 #{board}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="slot-mode-buttons" aria-label={`자리 ${index + 1} 상태`}>
                    {hostSeat ? (
                      <span className="host-lock">고정</span>
                    ) : (
                      <>
                        <button disabled={!isHost || remoteHuman} className={seat.kind === 'empty' ? 'selected' : ''} onClick={() => setMode(index, 'empty')}>열림</button>
                        <button disabled={!isHost || remoteHuman} className={seat.kind === 'human' ? 'selected' : ''} onClick={() => setMode(index, 'human')}>사람</button>
                        <button disabled={!isHost || remoteHuman} className={seat.kind === 'ai' ? 'selected' : ''} onClick={() => setMode(index, 'ai')}>AI</button>
                        <button disabled={!isHost || remoteHuman} className={seat.kind === 'closed' ? 'selected danger' : ''} onClick={() => setMode(index, 'closed')}>잠금</button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="lobby-panel room-settings">
          <span className="section-kicker">ROOM</span>
          <h2>방 설정</h2>
          <div className="setting-block">
            <span>내 상태</span>
            <strong>{isHost ? '방장' : '참가자'} · {networkStatus === 'online' ? '온라인' : '로컬'}</strong>
          </div>
          <div className="setting-block">
            <span>시작 조건</span>
            <strong>열린 자리는 모두 사람 또는 AI로 채우기</strong>
            <small>쓰지 않을 자리는 잠그면 됩니다. 최소 2명.</small>
          </div>
          <button className="wide" onClick={copyInvite}>초대 링크 복사</button>
          <button
            className="primary wide start-lobby"
            disabled={!isHost || !canStartRoom(room)}
            onClick={() => updateRoom(startRoom(room))}
          >
            게임 시작
          </button>
          {!canStartRoom(room) && <p className="hint">빈 열린 자리가 남아 있습니다. 사람/AI를 넣거나 그 자리를 잠그세요.</p>}
          {!SERVER_URL && <p className="server-note">온라인 서버 URL이 빌드에 설정되지 않으면 로컬 모드로 동작합니다. 저장소에 Cloudflare Room Server도 함께 추가했습니다.</p>}
        </aside>
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
      <div className="depot-tiles">{tiles.map((tile, i) => <TileChip key={`${tile}-${i}`} family={tile} />)}</div>
      <div className="goods-slot">상품 {number}</div>
    </div>
  );
}

function EstateBoard() {
  let cursor = 0;
  return (
    <div className="estate-wrap">
      <div className="estate-title"><strong>내 영지</strong><span>배치 가능한 칸은 행동 선택 후 강조</span></div>
      <div className="estate-grid">
        {estateRows.map((count, rowIndex) => {
          const cells = estateFamilies.slice(cursor, cursor + count);
          cursor += count;
          return (
            <div className="estate-row" key={rowIndex}>
              {cells.map((family, colIndex) => {
                const isCenter = rowIndex === 3 && colIndex === 3;
                return (
                  <div key={`${rowIndex}-${colIndex}`} className={`hex estate-hex family-${family} ${isCenter ? 'occupied' : ''}`}>
                    <span>{isCenter ? '성' : ((rowIndex + colIndex) % 6) + 1}</span>
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

function DiceButton({ value, used, selected, onClick }: { value: DieValue; used: boolean; selected: boolean; onClick: () => void }) {
  return (
    <button className={`big-die ${used ? 'used' : ''} ${selected ? 'selected' : ''}`} disabled={used} onClick={onClick}>
      <span className="die-face">{value}</span>
      <small>{used ? '사용 완료' : selected ? '선택됨' : '이 주사위 사용'}</small>
    </button>
  );
}

function GameTable({
  room,
  localPlayerId,
  networkStatus,
  progressByPlayer,
  publishProgress,
  activities,
  publishEvent,
}: {
  room: RoomState;
  localPlayerId: string;
  networkStatus: NetworkStatus;
  progressByPlayer: Record<string, PublicTurnProgress>;
  publishProgress: (progress: PublicTurnProgress) => void;
  activities: Activity[];
  publishEvent: (playerId: string, message: string) => void;
}) {
  const players = useMemo(() => room.seats.filter(isOccupied), [room.seats]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [actionNumber, setActionNumber] = useState<1 | 2>(1);
  const [selectedDie, setSelectedDie] = useState<0 | 1 | null>(null);
  const [selectedAction, setSelectedAction] = useState<DiceActionKind | null>(null);
  const [diceByPlayer, setDiceByPlayer] = useState<Record<string, DiceState>>({});
  const activePlayer = players[activeIndex] ?? players[0];
  const localSeatIndex = players.findIndex((seat) => seat.playerId === localPlayerId);
  const perspectiveIndex = localSeatIndex >= 0 ? localSeatIndex : 0;
  const perspectivePlayer = players[perspectiveIndex] ?? activePlayer;
  const perspectiveDice = perspectivePlayer ? diceByPlayer[perspectivePlayer.playerId] ?? defaultDice(perspectiveIndex) : defaultDice(0);
  const myTurn = !!activePlayer && activePlayer.playerId === perspectivePlayer?.playerId;

  useEffect(() => {
    setDiceByPlayer((current) => {
      const next = { ...current };
      players.forEach((player, index) => {
        if (!next[player.playerId]) next[player.playerId] = defaultDice(index);
      });
      return next;
    });
  }, [players]);

  const stageLabel = selectedDie === null
    ? '주사위를 선택하세요'
    : selectedAction === null
      ? '행동을 선택하세요'
      : `${ACTION_LABELS[selectedAction]} · 대상 선택/확정`;

  useEffect(() => {
    if (!activePlayer || !myTurn) return;
    publishProgress({
      playerId: activePlayer.playerId,
      actionNumber,
      stage: selectedDie === null ? 'choose-die' : selectedAction === null ? 'choose-action' : 'choose-target',
      label: stageLabel,
      updatedAt: Date.now(),
    });
  }, [actionNumber, activePlayer?.playerId, myTurn, selectedAction, selectedDie, stageLabel]);

  const chooseDie = (index: 0 | 1) => {
    if (!myTurn || perspectiveDice.used[index]) return;
    setSelectedDie(index);
    setSelectedAction(null);
  };

  const commitAction = () => {
    if (!myTurn || selectedDie === null || !selectedAction || !activePlayer) return;
    const usedValue = perspectiveDice.values[selectedDie];
    setDiceByPlayer((current) => ({
      ...current,
      [activePlayer.playerId]: {
        ...current[activePlayer.playerId],
        used: current[activePlayer.playerId]
          ? current[activePlayer.playerId].used.map((value, index) => index === selectedDie ? true : value) as [boolean, boolean]
          : [selectedDie === 0, selectedDie === 1],
      },
    }));
    publishEvent(activePlayer.playerId, `주사위 ${usedValue}로 '${ACTION_LABELS[selectedAction]}' 행동을 완료했습니다.`);
    setSelectedDie(null);
    setSelectedAction(null);
    if (actionNumber === 1) {
      setActionNumber(2);
    } else {
      setActionNumber(1);
      setActiveIndex((activeIndex + 1) % Math.max(players.length, 1));
    }
  };

  return (
    <main className="game-page">
      <header className="turn-banner">
        <div className="turn-banner-main">
          <span className="turn-icon">♟</span>
          <div>
            <span className="section-kicker">현재 턴</span>
            <h1>{activePlayer?.displayName ?? 'Player'} · 행동 {actionNumber}/2</h1>
            <p>{myTurn ? stageLabel : `${activePlayer?.displayName ?? '상대'}가 진행 중입니다. 확정 행동과 진행 단계가 실시간으로 표시됩니다.`}</p>
          </div>
        </div>
        <div className="banner-side">
          <span className={`net-pill ${networkStatus}`}>{networkStatus === 'online' ? '실시간 동기화' : networkStatus === 'local' ? '로컬 게임' : '연결 확인 중'}</span>
          <strong>남은 행동 {3 - actionNumber}</strong>
        </div>
      </header>

      <div className="game-layout">
        <aside className="players-column">
          <div className="rail-title">플레이어 진행</div>
          {players.map((seat, index) => {
            const dice = diceByPlayer[seat.playerId] ?? defaultDice(index);
            const progress = progressByPlayer[seat.playerId];
            const active = index === activeIndex;
            return (
              <article className={`player-progress-card color-${seat.color ?? 'blue'} ${active ? 'active' : ''}`} key={seat.playerId}>
                <div className="player-line">
                  <div><strong>{seat.displayName}</strong><span>{active ? '현재 턴' : progress?.label ?? '대기 중'}</span></div>
                  <b>{index * 4}점</b>
                </div>
                <div className="mini-dice-row">
                  {dice.values.map((value, dieIndex) => <span className={dice.used[dieIndex] ? 'used' : ''} key={dieIndex}>{value}</span>)}
                  <em>{progress ? `행동 ${progress.actionNumber}/2` : active ? `행동 ${actionNumber}/2` : '대기'}</em>
                </div>
                <div className="resource-grid"><span>일꾼 <b>{1 + index}</b></span><span>은화 <b>{1}</b></span><span>보관 <b>{index % 3}/3</b></span><span>상품 <b>{index + 1}</b></span></div>
              </article>
            );
          })}
        </aside>

        <section className="center-stack">
          <section className="common-board board-panel">
            <div className="board-topline"><strong>공용 보드</strong><span>페이즈 A · 라운드 1/5</span></div>
            <div className="phase-track">{['A', 'B', 'C', 'D', 'E'].map((phase, index) => <span className={index === 0 ? 'current' : ''} key={phase}>{phase}<small>{10 - index * 2}</small></span>)}</div>
            <div className="depot-grid">
              {depotTiles.map((tiles, index) => <Depot key={index} number={index + 1} tiles={tiles} />)}
              <div className="black-depot"><span>검은 창고</span><div><TileChip family="building" /><TileChip family="ship" /></div><small>은화 2개 · 턴당 1회</small></div>
            </div>
            <div className="board-footer"><div><strong>흰 주사위</strong><span className="die-large">4</span></div><div><strong>상품 큐</strong><span>▰ ▰ ▰ ▰ ▰</span></div><div><strong>순서</strong><span>{players.map((player, index) => `${index + 1}. ${player.displayName}`).join('  ')}</span></div></div>
          </section>

          <section className="player-board board-panel">
            <div className="storage-column">
              <h3>내 보관소</h3>
              <div className="storage-slots"><TileChip family="building" /><span className="hex mini empty-hex" /><span className="hex mini empty-hex" /></div>
              <h3>상품</h3>
              <div className="goods-stacks"><span>1 × 2</span><span>4 × 1</span><span>빈 칸</span></div>
            </div>
            <EstateBoard />
            <div className="board-summary"><strong>{perspectivePlayer?.displayName ?? 'Player'}</strong><span>영지 #{perspectivePlayer?.board ?? 1}</span><span>{colorLabel(perspectivePlayer?.color)}</span><span>타일을 누르면 가능한 행동만 표시</span></div>
          </section>
        </section>

        <aside className="action-column">
          <section className="action-panel">
            <div className="panel-title-row compact-row"><div><span className="section-kicker">내 차례 조작</span><h2>내 주사위</h2></div><span className="action-counter">{myTurn ? `행동 ${actionNumber}/2` : '대기'}</span></div>
            <p className="action-help">주사위가 여기 항상 보입니다. 먼저 주사위를 고르고, 그 다음 행동을 고르세요.</p>
            <div className="big-dice-row">
              <DiceButton value={perspectiveDice.values[0]} used={perspectiveDice.used[0]} selected={selectedDie === 0} onClick={() => chooseDie(0)} />
              <DiceButton value={perspectiveDice.values[1]} used={perspectiveDice.used[1]} selected={selectedDie === 1} onClick={() => chooseDie(1)} />
            </div>
            <div className="progress-steps">
              <span className={selectedDie !== null ? 'done' : 'current'}>1 주사위</span><span className={selectedAction ? 'done' : selectedDie !== null ? 'current' : ''}>2 행동</span><span className={selectedAction ? 'current' : ''}>3 대상/확정</span>
            </div>
            <div className="action-stack">
              {(Object.keys(ACTION_LABELS) as DiceActionKind[]).map((action) => (
                <button className={selectedAction === action ? 'selected' : ''} disabled={!myTurn || selectedDie === null} key={action} onClick={() => setSelectedAction(action)}>
                  <strong>{ACTION_LABELS[action]}</strong><span>{action === 'take-workers' ? '주사위 값과 무관' : '선택한 주사위 값 사용'}</span>
                </button>
              ))}
            </div>
            <button className="primary wide confirm-action" disabled={!myTurn || selectedDie === null || !selectedAction} onClick={commitAction}>이 행동 확정</button>
          </section>

          <section className="activity-panel">
            <div className="activity-heading"><h3>방금 무슨 일이 있었나요?</h3><span>실시간</span></div>
            <div className="activity-list">
              {activities.length === 0 ? <p className="hint">확정된 행동이 여기에 쌓입니다.</p> : activities.slice(0, 8).map((item, index) => {
                const player = players.find((entry) => entry.playerId === item.playerId);
                return <div className={index === 0 ? 'latest' : ''} key={item.id}><strong>{player?.displayName ?? 'Player'}</strong><p>{item.message}</p><small>{new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>;
              })}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

export function App() {
  const localPlayerId = useMemo(getPlayerId, []);
  const [displayName] = useState(() => localStorage.getItem('burgundy-name') || 'Player');
  const initialCode = useMemo(() => new URL(window.location.href).searchParams.get('room') || randomRoomCode(), []);
  const [room, setRoom] = useState<RoomState>(() => makeRoom(initialCode, localPlayerId, displayName));
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>(SERVER_URL ? 'connecting' : 'local');
  const [presence, setPresence] = useState<Presence[]>([]);
  const [progressByPlayer, setProgressByPlayer] = useState<Record<string, PublicTurnProgress>>({});
  const [activities, setActivities] = useState<Activity[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const roomRef = useRef(room);
  roomRef.current = room;

  const onServerMessage = (message: RoomServerMessage) => {
    if (message.type === 'hello') {
      setPresence(message.players);
      if (message.room) setRoom(message.room);
      else sendSocket(socketRef.current, { type: 'room-update', room: roomRef.current });
    }
    if (message.type === 'room') setRoom(message.room);
    if (message.type === 'presence') setPresence(message.players);
    if (message.type === 'progress') setProgressByPlayer((current) => ({ ...current, [message.progress.playerId]: message.progress }));
    if (message.type === 'event') setActivities((current) => [{ id: message.id, playerId: message.playerId, message: message.message, at: message.at }, ...current].slice(0, 30));
  };

  useEffect(() => {
    if (!SERVER_URL) return;
    const socket = connectRoomSocket({
      serverUrl: SERVER_URL,
      roomCode: room.code,
      playerId: localPlayerId,
      displayName,
      onMessage: onServerMessage,
      onStatus: (status) => setNetworkStatus(status),
    });
    socketRef.current = socket;
    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, [room.code, localPlayerId, displayName]);

  const updateRoom = (next: RoomState) => {
    setRoom(next);
    sendSocket(socketRef.current, { type: 'room-update', room: next });
  };

  const publishProgress = (progress: PublicTurnProgress) => {
    setProgressByPlayer((current) => ({ ...current, [progress.playerId]: progress }));
    sendSocket(socketRef.current, { type: 'progress', progress });
  };

  const publishEvent = (playerId: string, message: string) => {
    const payload = { type: 'event', message, at: Date.now() };
    if (!sendSocket(socketRef.current, payload)) {
      setActivities((current) => [{ id: crypto.randomUUID(), playerId, message, at: payload.at }, ...current].slice(0, 30));
    }
  };

  return room.started ? (
    <GameTable
      room={room}
      localPlayerId={localPlayerId}
      networkStatus={networkStatus}
      progressByPlayer={progressByPlayer}
      publishProgress={publishProgress}
      activities={activities}
      publishEvent={publishEvent}
    />
  ) : (
    <Lobby room={room} updateRoom={updateRoom} localPlayerId={localPlayerId} networkStatus={networkStatus} presence={presence} />
  );
}
