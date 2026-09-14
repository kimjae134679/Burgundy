import { describe, expect, it } from 'vitest';
import {
  adjustDie,
  colorCompletionBonus,
  finalResourceScore,
  regionCompletionScore,
  soldGoodsVpPerTile,
  workersNeeded,
} from './rules';
import {
  addAi,
  addAiToSeat,
  canStartRoom,
  closeSeat,
  createRoom,
  createSoloVsAiRoom,
  setSeatOpen,
} from './room';

describe('verified base scoring helpers', () => {
  it('scores region size plus phase bonus', () => {
    expect(regionCompletionScore(1, 'A')).toBe(11);
    expect(regionCompletionScore(5, 'C')).toBe(21);
    expect(regionCompletionScore(8, 'E')).toBe(38);
  });

  it('scores color completion by player count', () => {
    expect(colorCompletionBonus(2, 'first')).toBe(5);
    expect(colorCompletionBonus(4, 'first')).toBe(7);
    expect(colorCompletionBonus(2, 'second')).toBe(2);
    expect(colorCompletionBonus(4, 'second')).toBe(4);
  });

  it('scores sold goods by player count', () => {
    expect(soldGoodsVpPerTile(2)).toBe(2);
    expect(soldGoodsVpPerTile(3)).toBe(3);
    expect(soldGoodsVpPerTile(4)).toBe(4);
  });

  it('supports worker wrap between 1 and 6', () => {
    expect(adjustDie(6, 1)).toBe(1);
    expect(adjustDie(1, -1)).toBe(6);
    expect(workersNeeded(1, 6)).toBe(1);
    expect(workersNeeded(2, 6)).toBe(2);
  });

  it('scores leftover resources at game end', () => {
    expect(
      finalResourceScore({ unsoldGoods: 3, silverlings: 2, workers: 5, monasteryVp: 7 }),
    ).toBe(14);
  });
});

describe('room model', () => {
  it('uses a human plus AI for the solo shortcut', () => {
    const room = createSoloVsAiRoom({
      code: 'SOLO01',
      hostPlayerId: 'human-1',
      hostDisplayName: 'You',
      totalPlayers: 2,
    });

    expect(room.seats.map((seat) => seat.kind)).toEqual(['human', 'ai']);
    expect(canStartRoom(room)).toBe(true);
  });

  it('fills empty room seats with AI', () => {
    let room = createRoom({
      code: 'ROOM01',
      hostPlayerId: 'human-1',
      hostDisplayName: 'You',
      maxPlayers: 3,
    });
    room = addAi(room);
    room = addAi(room, 'hard');

    expect(room.seats.map((seat) => seat.kind)).toEqual(['human', 'ai', 'ai']);
    expect(canStartRoom(room)).toBe(true);
  });

  it('starts with two occupied seats when unused seats are locked', () => {
    let room = createRoom({
      code: 'LOCK01',
      hostPlayerId: 'human-1',
      hostDisplayName: 'You',
      maxPlayers: 4,
    });
    room = addAiToSeat(room, 1, 'normal');
    room = closeSeat(room, 2);
    room = closeSeat(room, 3);

    expect(room.seats.map((seat) => seat.kind)).toEqual(['human', 'ai', 'closed', 'closed']);
    expect(canStartRoom(room)).toBe(true);

    room = setSeatOpen(room, 3);
    expect(canStartRoom(room)).toBe(false);
  });
});
