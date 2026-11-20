/** Minimal structured logger — one JSON object per line, no dependencies. */
export interface LogFields {
  roomId?: string;
  workerId?: string;
  commandSeq?: number;
  eventSeq?: number;
  [key: string]: unknown;
}

const workerId = process.env.HOSTNAME ?? String(process.pid);

function emit(level: string, message: string, fields: LogFields = {}): void {
  process.stdout.write(`${JSON.stringify({
    ts: new Date().toISOString(), level, message, workerId, ...fields,
  })}\n`);
}

export const logger = {
  info: (message: string, fields?: LogFields) => emit('info', message, fields),
  warn: (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) => emit('error', message, fields),
};
