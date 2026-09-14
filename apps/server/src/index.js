function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
}

function safeAttachment(socket) {
  try {
    return socket.deserializeAttachment() || {};
  } catch {
    return {};
  }
}

function publicPresence(ctx) {
  return ctx.getWebSockets().map((socket) => {
    const attachment = safeAttachment(socket);
    return {
      playerId: attachment.playerId || 'unknown',
      displayName: attachment.displayName || 'Player',
    };
  });
}

export class RoomHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async loadRoom() {
    return (await this.ctx.storage.get('room')) || null;
  }

  async saveRoom(room) {
    await this.ctx.storage.put('room', room);
    return room;
  }

  broadcast(payload, except = null) {
    const text = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      try {
        socket.send(text);
      } catch {
        // A stale socket will be cleaned up by the runtime.
      }
    }
  }

  async broadcastPresence(room = null) {
    const currentRoom = room || await this.loadRoom();
    this.broadcast({
      type: 'presence',
      players: publicPresence(this.ctx),
      hostPlayerId: currentRoom?.hostPlayerId || null,
    });
  }

  async fetch(request) {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade?.toLowerCase() !== 'websocket') {
      return json({ ok: true, service: 'burgundy-room-server' });
    }

    const url = new URL(request.url);
    const playerId = url.searchParams.get('playerId')?.trim();
    const displayName = (url.searchParams.get('name') || 'Player').trim().slice(0, 40);
    if (!playerId) return json({ error: 'playerId is required' }, 400);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ playerId, displayName });
    this.ctx.acceptWebSocket(server);

    let room = await this.loadRoom();
    if (room && !room.started) {
      const existing = room.seats?.findIndex((seat) => seat.kind === 'human' && seat.playerId === playerId) ?? -1;
      if (existing >= 0) {
        room.seats[existing] = { ...room.seats[existing], connected: true, displayName };
        room.revision = (room.revision || 0) + 1;
        await this.saveRoom(room);
      } else {
        const emptyIndex = room.seats?.findIndex((seat) => seat.kind === 'empty') ?? -1;
        if (emptyIndex >= 0) {
          const previous = room.seats[emptyIndex];
          room.seats[emptyIndex] = {
            kind: 'human',
            playerId,
            displayName,
            connected: true,
            color: previous.color,
            board: previous.board,
          };
          room.revision = (room.revision || 0) + 1;
          await this.saveRoom(room);
          this.broadcast({ type: 'room', room, reason: 'player-joined' });
        }
      }
    }

    server.send(JSON.stringify({
      type: 'hello',
      room,
      hostPlayerId: room?.hostPlayerId || null,
      players: publicPresence(this.ctx),
    }));
    await this.broadcastPresence(room);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, rawMessage) {
    const sender = safeAttachment(socket);
    let message;
    try {
      message = JSON.parse(typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage));
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON message.' }));
      return;
    }

    if (message.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    let room = await this.loadRoom();

    if (message.type === 'room-update') {
      const incoming = message.room;
      if (!incoming || typeof incoming !== 'object') return;
      const canWrite = !room || room.hostPlayerId === sender.playerId;
      if (!canWrite) {
        socket.send(JSON.stringify({ type: 'error', message: 'Only the room host can change lobby state.' }));
        return;
      }
      incoming.hostPlayerId = room?.hostPlayerId || sender.playerId;
      incoming.revision = Math.max(Number(room?.revision || 0) + 1, Number(incoming.revision || 0));
      room = await this.saveRoom(incoming);
      this.broadcast({ type: 'room', room, reason: 'host-update' });
      await this.broadcastPresence(room);
      return;
    }

    if (message.type === 'progress') {
      const incoming = message.progress || {};
      const progress = {
        playerId: sender.playerId,
        actionNumber: incoming.actionNumber === 2 ? 2 : incoming.actionNumber === 1 ? 1 : 0,
        stage: typeof incoming.stage === 'string' ? incoming.stage : 'waiting',
        label: String(incoming.label || '').slice(0, 120),
        updatedAt: Date.now(),
      };
      this.broadcast({ type: 'progress', progress });
      return;
    }

    if (message.type === 'event') {
      const event = {
        type: 'event',
        id: crypto.randomUUID(),
        playerId: sender.playerId,
        message: String(message.message || '').slice(0, 240),
        at: Date.now(),
      };
      const previous = (await this.ctx.storage.get('events')) || [];
      await this.ctx.storage.put('events', [event, ...previous].slice(0, 50));
      this.broadcast(event);
      return;
    }
  }

  async webSocketClose(socket) {
    const leaving = safeAttachment(socket);
    let room = await this.loadRoom();
    if (!room) {
      await this.broadcastPresence(null);
      return;
    }

    const seatIndex = room.seats?.findIndex((seat) => seat.kind === 'human' && seat.playerId === leaving.playerId) ?? -1;
    if (seatIndex >= 0) {
      room.seats[seatIndex] = { ...room.seats[seatIndex], connected: false };
    }

    if (room.hostPlayerId === leaving.playerId) {
      const connectedIds = new Set(publicPresence(this.ctx).map((player) => player.playerId).filter((id) => id !== leaving.playerId));
      const nextHost = room.seats?.find((seat) => seat.kind === 'human' && connectedIds.has(seat.playerId));
      if (nextHost) room.hostPlayerId = nextHost.playerId;
    }

    room.revision = (room.revision || 0) + 1;
    room = await this.saveRoom(room);
    this.broadcast({ type: 'room', room, reason: 'player-left' });
    await this.broadcastPresence(room);
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers': '*',
        },
      });
    }

    if (url.pathname === '/health') return json({ ok: true });
    const match = url.pathname.match(/^\/room\/([A-Za-z0-9_-]{3,32})$/);
    if (!match) return json({ error: 'Use /room/:code' }, 404);

    const roomId = env.ROOMS.idFromName(match[1].toUpperCase());
    const room = env.ROOMS.get(roomId);
    return room.fetch(request);
  },
};
