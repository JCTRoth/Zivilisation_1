/** Public surface of the shared simulation package. */
export { default, default as GameEngine } from './game/engine/GameEngine';
export * from './ports/runtime';
export * from './ports/saveStore';
export * from './ports/campaignStore';
export type { Command, CommandContext, CommandResult, CommandRejection } from './types/commands';
export * from './types/saves';
export type { GameSettings } from './game/engine/GameEngine';
