/** In-process counters exposed as Prometheus text at GET /metrics. */
const commands = new Map<string, number>();
const events = new Map<string, number>();
let saves = 0;
let streams = 0;

const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

export const metrics = {
  command(type: string, result: 'ok' | 'rejected'): void {
    bump(commands, `${type}|${result}`);
  },
  event(type: string): void {
    bump(events, type);
  },
  save(): void {
    saves++;
  },
  stream(): void {
    streams++;
  },
  render(activeRooms: number): string {
    const lines: string[] = [
      '# HELP civ1_commands_total Commands handled by this process.',
      '# TYPE civ1_commands_total counter',
    ];
    for (const [key, value] of commands) {
      const [type, result] = key.split('|');
      lines.push(`civ1_commands_total{type="${type}",result="${result}"} ${value}`);
    }
    lines.push('# HELP civ1_events_total Engine events classified by this process.', '# TYPE civ1_events_total counter');
    for (const [type, value] of events) lines.push(`civ1_events_total{type="${type}"} ${value}`);
    lines.push(
      '# TYPE civ1_saves_total counter', `civ1_saves_total ${saves}`,
      '# TYPE civ1_event_streams_total counter', `civ1_event_streams_total ${streams}`,
      '# TYPE civ1_rooms gauge', `civ1_rooms ${activeRooms}`,
    );
    return `${lines.join('\n')}\n`;
  },
};
