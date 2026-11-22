import type { GameSettings } from '@civ1/shared';

/**
 * The room-creation payload is today's URL parameters, made explicit:
 * maptype/seed/civs/players. Everything here is plain data so two clients
 * joining the same lobby derive byte-identical settings.
 */
export interface LobbyConfig {
  seed?: number;
  mapType?: string;
  mapWidth?: number;
  mapHeight?: number;
  /** Civ1 world-shaping sliders — part of "the same options" online. */
  landMass?: number;
  temperature?: number;
  climate?: number;
  age?: number;
  numberOfCivilizations?: number;
  humanSeats?: number[];
  playerCivilizations?: (number | null)[];
  playerColors?: (string | null)[];
  playerSpawns?: (number | null)[];
  difficulty?: string;
  gameMode?: 'single' | 'hotseat';
  fixedAlliances?: boolean;
  teamAssignments?: number[];
}

export function settingsFromLobby(lobby: LobbyConfig): GameSettings {
  const seats = lobby.humanSeats ?? [0];
  return {
    difficulty: lobby.difficulty ?? 'PRINCE',
    mapType: lobby.mapType ?? 'EARTH',
    numberOfCivilizations: lobby.numberOfCivilizations ?? 4,
    playerCivilization: seats[0] ?? 0,
    startingYear: -4000,
    startingGold: 50,
    mapSeed: lobby.seed,
    rngSeed: lobby.seed,
    mapWidth: lobby.mapWidth,
    mapHeight: lobby.mapHeight,
    landMass: lobby.landMass,
    temperature: lobby.temperature,
    climate: lobby.climate,
    age: lobby.age,
    gameMode: lobby.gameMode ?? (seats.length > 1 ? 'hotseat' : 'single'),
    humanPlayerIds: seats,
    playerCivilizations: lobby.playerCivilizations,
    playerColors: lobby.playerColors,
    playerSpawns: lobby.playerSpawns,
    fixedAlliances: lobby.fixedAlliances,
    teamAssignments: lobby.teamAssignments,
  };
}
