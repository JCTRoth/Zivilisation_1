import type { Command, CommandContext, CommandResult } from '@civ1/shared';

/**
 * One inbound command from a connection. The context is built by the server
 * from the authenticated seat and the room's live turn/sequence — never from
 * the client payload — then handed to `GameEngine.submit`, which owns both the
 * authorisation gate and the rules.
 */
export interface CommandEnvelope {
  command: Command;
  context: CommandContext;
  /** Transport-level id used to correlate the reply with the sender. */
  requestId?: string;
}

export type CommandHandler = (envelope: CommandEnvelope) => CommandResult | Promise<CommandResult>;
