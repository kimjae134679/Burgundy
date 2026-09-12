export type PlayerCount = 2 | 3 | 4;
export type Phase = 'A' | 'B' | 'C' | 'D' | 'E';
export type Round = 1 | 2 | 3 | 4 | 5;
export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

export type RulesetId = 'special-edition-base';

export type SeatKind = 'human' | 'ai' | 'empty';
export type AiDifficulty = 'easy' | 'normal' | 'hard';

export interface HumanSeat {
  kind: 'human';
  playerId: string;
  displayName: string;
  connected: boolean;
}

export interface AiSeat {
  kind: 'ai';
  playerId: string;
  displayName: string;
  difficulty: AiDifficulty;
}

export interface EmptySeat {
  kind: 'empty';
}

export type RoomSeat = HumanSeat | AiSeat | EmptySeat;

export interface RoomState {
  code: string;
  visibility: 'private' | 'public';
  maxPlayers: PlayerCount;
  seats: RoomSeat[];
  started: boolean;
  replaceAiOnJoin: boolean;
}

export type HexTileFamily =
  | 'castle'
  | 'mine'
  | 'ship'
  | 'animal'
  | 'building'
  | 'monastery';

export type BuildingType =
  | 'warehouse'
  | 'carpenters-workshop'
  | 'church'
  | 'market'
  | 'boarding-house'
  | 'bank'
  | 'town-hall'
  | 'watchtower';

export interface HexTile {
  id: string;
  family: HexTileFamily;
  buildingType?: BuildingType;
  monasteryNumber?: number;
  animalType?: string;
  animalCount?: number;
}

export interface EstateSpace {
  id: string;
  dieValue: DieValue;
  family: HexTileFamily;
  regionId: string;
  tileId: string | null;
}

export interface GoodsStack {
  type: DieValue;
  count: number;
}

export interface PlayerState {
  playerId: string;
  score: number;
  workers: number;
  silverlings: number;
  dice: [DieValue, DieValue];
  usedDice: [boolean, boolean];
  storage: Array<HexTile | null>;
  goods: GoodsStack[];
  soldGoods: GoodsStack[];
  estate: EstateSpace[];
  claimedColorBonuses: HexTileFamily[];
}

export interface DepotState {
  number: DieValue;
  tiles: HexTile[];
  goods: GoodsStack[];
}

export interface GameState {
  ruleset: RulesetId;
  playerCount: PlayerCount;
  phase: Phase;
  round: Round;
  activePlayerIndex: number;
  turnOrder: string[];
  whiteDie: DieValue;
  players: PlayerState[];
  depots: DepotState[];
  blackDepot: HexTile[];
  log: GameEvent[];
}

export type DiceActionKind =
  | 'take-tile'
  | 'place-tile'
  | 'sell-goods'
  | 'take-workers';

export type GameEvent =
  | { type: 'score'; playerId: string; amount: number; reason: string }
  | { type: 'workers'; playerId: string; delta: number; reason: string }
  | { type: 'silverlings'; playerId: string; delta: number; reason: string }
  | { type: 'note'; message: string };
