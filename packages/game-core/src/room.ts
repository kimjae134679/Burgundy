import type { AiDifficulty, PlayerCount, RoomSeat, RoomState } from './types';

function emptySeats(count: number): RoomSeat[] {
  return Array.from({ length: count }, () => ({ kind: 'empty' as const }));
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
    maxPlayers,
    seats: [
      {
        kind: 'human',
        playerId: input.hostPlayerId,
        displayName: input.hostDisplayName,
        connected: true,
      },
      ...emptySeats(maxPlayers - 1),
    ],
    started: false,
    replaceAiOnJoin: false,
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
          },
    ),
  };
}

export function addAi(
  room: RoomState,
  difficulty: AiDifficulty = 'normal',
): RoomState {
  if (room.started) return room;
  const index = room.seats.findIndex((seat) => seat.kind === 'empty');
  if (index < 0) return room;

  const seats = [...room.seats];
  seats[index] = {
    kind: 'ai',
    playerId: `ai-${index}-${room.code}`,
    displayName: `AI ${index + 1}`,
    difficulty,
  };
  return { ...room, seats };
}

export function removeAi(room: RoomState, seatIndex: number): RoomState {
  if (room.started || room.seats[seatIndex]?.kind !== 'ai') return room;
  const seats = [...room.seats];
  seats[seatIndex] = { kind: 'empty' };
  return { ...room, seats };
}

export function canStartRoom(room: RoomState): boolean {
  if (room.started) return false;
  const occupied = room.seats.filter((seat) => seat.kind !== 'empty');
  return occupied.length >= 2 && occupied.length === room.maxPlayers;
}

export function startRoom(room: RoomState): RoomState {
  if (!canStartRoom(room)) {
    throw new Error('Room needs 2-4 occupied seats and no empty seat before starting.');
  }
  return { ...room, started: true };
}
