import type {
  AiDifficulty,
  PlayerColor,
  PlayerCount,
  RoomSeat,
  RoomState,
} from './types';

const COLORS: PlayerColor[] = ['blue', 'red', 'green', 'gold'];

function baseSeat(index: number): Pick<RoomSeat, 'color' | 'board'> {
  return { color: COLORS[index] ?? 'blue', board: 1 };
}

function emptySeats(count: number, offset = 0): RoomSeat[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'empty' as const,
    ...baseSeat(index + offset),
  }));
}

function bump(room: RoomState, seats = room.seats): RoomState {
  return { ...room, seats, revision: room.revision + 1 };
}

export function createRoom(input: {
  code: string;
  hostPlayerId: string;
  hostDisplayName: string;
  maxPlayers?: PlayerCount;
  visibility?: 'private' | 'public';
}): RoomState {
  const maxPlayers = input.maxPlayers ?? 4;
  return {
    code: input.code,
    visibility: input.visibility ?? 'private',
    hostPlayerId: input.hostPlayerId,
    maxPlayers,
    seats: [
      {
        kind: 'human',
        playerId: input.hostPlayerId,
        displayName: input.hostDisplayName,
        connected: true,
        ...baseSeat(0),
      },
      ...emptySeats(maxPlayers - 1, 1),
    ],
    started: false,
    replaceAiOnJoin: false,
    revision: 0,
  };
}

export function createSoloVsAiRoom(input: {
  code: string;
  hostPlayerId: string;
  hostDisplayName: string;
  totalPlayers?: PlayerCount;
  difficulty?: AiDifficulty;
}): RoomState {
  const totalPlayers = input.totalPlayers ?? 2;
  const difficulty = input.difficulty ?? 'normal';
  const room = createRoom({
    code: input.code,
    hostPlayerId: input.hostPlayerId,
    hostDisplayName: input.hostDisplayName,
    maxPlayers: totalPlayers,
    visibility: 'private',
  });

  return {
    ...room,
    seats: room.seats.map((seat, index) =>
      index === 0
        ? seat
        : {
            kind: 'ai' as const,
            playerId: `ai-${index}`,
            displayName: `AI ${index}`,
            difficulty,
            color: seat.color,
            board: seat.board,
          },
    ),
  };
}

export function setSeatOpen(room: RoomState, seatIndex: number): RoomState {
  if (room.started || seatIndex === 0 || !room.seats[seatIndex]) return room;
  const current = room.seats[seatIndex];
  const seats = [...room.seats];
  seats[seatIndex] = { kind: 'empty', color: current.color, board: current.board };
  return bump(room, seats);
}

export function closeSeat(room: RoomState, seatIndex: number): RoomState {
  if (room.started || seatIndex === 0 || !room.seats[seatIndex]) return room;
  const current = room.seats[seatIndex];
  if (current.kind === 'human') return room;
  const seats = [...room.seats];
  seats[seatIndex] = { kind: 'closed', color: current.color, board: current.board };
  return bump(room, seats);
}

export function setLocalHumanAtSeat(
  room: RoomState,
  seatIndex: number,
  displayName = `Player ${seatIndex + 1}`,
): RoomState {
  if (room.started || seatIndex === 0 || !room.seats[seatIndex]) return room;
  const current = room.seats[seatIndex];
  if (current.kind === 'human' && current.playerId !== room.hostPlayerId) return room;
  const seats = [...room.seats];
  seats[seatIndex] = {
    kind: 'human',
    playerId: `local-${seatIndex}-${room.code}`,
    displayName,
    connected: true,
    color: current.color,
    board: current.board,
  };
  return bump(room, seats);
}

export function addAiToSeat(
  room: RoomState,
  seatIndex: number,
  difficulty: AiDifficulty = 'normal',
): RoomState {
  if (room.started || seatIndex === 0 || !room.seats[seatIndex]) return room;
  const current = room.seats[seatIndex];
  if (current.kind === 'human') return room;
  const seats = [...room.seats];
  seats[seatIndex] = {
    kind: 'ai',
    playerId: `ai-${seatIndex}-${room.code}`,
    displayName: `AI ${seatIndex + 1}`,
    difficulty,
    color: current.color,
    board: current.board,
  };
  return bump(room, seats);
}

export function addAi(
  room: RoomState,
  difficulty: AiDifficulty = 'normal',
): RoomState {
  if (room.started) return room;
  const index = room.seats.findIndex((seat, seatIndex) => seatIndex > 0 && seat.kind === 'empty');
  if (index < 0) return room;
  return addAiToSeat(room, index, difficulty);
}

export function removeAi(room: RoomState, seatIndex: number): RoomState {
  if (room.started || room.seats[seatIndex]?.kind !== 'ai') return room;
  return setSeatOpen(room, seatIndex);
}

export function setAiDifficulty(
  room: RoomState,
  seatIndex: number,
  difficulty: AiDifficulty,
): RoomState {
  if (room.started || room.seats[seatIndex]?.kind !== 'ai') return room;
  const seats = [...room.seats];
  seats[seatIndex] = { ...room.seats[seatIndex], difficulty };
  return bump(room, seats);
}

export function setSeatColor(room: RoomState, seatIndex: number, color: PlayerColor): RoomState {
  if (room.started || !room.seats[seatIndex]) return room;
  const seats = [...room.seats];
  seats[seatIndex] = { ...room.seats[seatIndex], color } as RoomSeat;
  return bump(room, seats);
}

export function setSeatBoard(room: RoomState, seatIndex: number, board: number): RoomState {
  if (room.started || !room.seats[seatIndex]) return room;
  const seats = [...room.seats];
  seats[seatIndex] = { ...room.seats[seatIndex], board } as RoomSeat;
  return bump(room, seats);
}

export function renameSeat(room: RoomState, seatIndex: number, displayName: string): RoomState {
  if (room.started || room.seats[seatIndex]?.kind !== 'human') return room;
  const seats = [...room.seats];
  seats[seatIndex] = { ...room.seats[seatIndex], displayName };
  return bump(room, seats);
}

export function canStartRoom(room: RoomState): boolean {
  if (room.started) return false;
  const openSeats = room.seats.filter((seat) => seat.kind !== 'closed');
  const occupied = openSeats.filter((seat) => seat.kind === 'human' || seat.kind === 'ai');
  const hasWaitingSeat = openSeats.some((seat) => seat.kind === 'empty');
  return occupied.length >= 2 && !hasWaitingSeat;
}

export function startRoom(room: RoomState): RoomState {
  if (!canStartRoom(room)) {
    throw new Error('Room needs at least 2 occupied seats; every open seat must be filled or closed.');
  }
  return { ...room, started: true, revision: room.revision + 1 };
}
