import type { PublicTurnProgress, RoomState } from '@burgundy/game-core';

export type RoomServerMessage =
  | { type: 'hello'; room: RoomState | null; hostPlayerId: string | null; players: Presence[] }
  | { type: 'room'; room: RoomState; reason?: string }
  | { type: 'presence'; players: Presence[]; hostPlayerId: string | null }
  | { type: 'progress'; progress: PublicTurnProgress }
  | { type: 'event'; id: string; playerId: string; message: string; at: number }
  | { type: 'error'; message: string }
  | { type: 'pong' };

export interface Presence {
  playerId: string;
  displayName: string;
}

export interface RoomSocketOptions {
  serverUrl: string;
  roomCode: string;
  playerId: string;
  displayName: string;
  onMessage: (message: RoomServerMessage) => void;
  onStatus: (status: 'connecting' | 'online' | 'offline') => void;
}

export function connectRoomSocket(options: RoomSocketOptions): WebSocket {
  const base = options.serverUrl.replace(/\/$/, '').replace(/^http/, 'ws');
  const url = new URL(`${base}/room/${encodeURIComponent(options.roomCode)}`);
  url.searchParams.set('playerId', options.playerId);
  url.searchParams.set('name', options.displayName);

  options.onStatus('connecting');
  const socket = new WebSocket(url);
  socket.addEventListener('open', () => options.onStatus('online'));
  socket.addEventListener('close', () => options.onStatus('offline'));
  socket.addEventListener('error', () => options.onStatus('offline'));
  socket.addEventListener('message', (event) => {
    try {
      options.onMessage(JSON.parse(String(event.data)) as RoomServerMessage);
    } catch {
      // Ignore malformed server messages instead of breaking the game UI.
    }
  });
  return socket;
}

export function sendSocket(socket: WebSocket | null, payload: unknown): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}
