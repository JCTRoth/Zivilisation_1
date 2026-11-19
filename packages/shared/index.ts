/** Public surface of the shared simulation package. */
export { default, default as GameEngine } from './game/engine/GameEngine';
export * from './ports/runtime';
export * from './ports/saveStore';
export type { Command, CommandContext, CommandResult, CommandRejection } from './types/commands';
export type { GameSettings } from './game/engine/GameEngine';
