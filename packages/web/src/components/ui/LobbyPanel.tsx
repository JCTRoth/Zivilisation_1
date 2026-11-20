import { useState } from 'react';
import { createRoomWithSeats, joinUrl, type LobbyResult } from '../../lobbyApi';

/**
 * Minimal multiplayer lobby (report step 5). Creates a server room, mints a
 * signed token per seat and shows one join link per player. The links are the
 * normal remote-mode URLs, so joining reuses the existing mirror-engine path.
 */
export default function LobbyPanel({ defaultServer }: { defaultServer?: string }) {
  const [server, setServer] = useState(defaultServer ?? 'http://localhost:8787');
  const [seats, setSeats] = useState(2);
  const [result, setResult] = useState<LobbyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await createRoomWithSeats(
        server,
        { seed: undefined, numberOfCivilizations: Math.max(2, seats) },
        Array.from({ length: seats }, (_, i) => i),
      ));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card bg-dark text-white" style={{ maxWidth: 640 }}>
      <div className="card-body">
        <h2 className="h4 mb-3">Multiplayer lobby</h2>
        <p className="text-muted small">
          Create an authoritative room on the game server, then open one join link per player.
        </p>
        <label className="form-label">Server URL</label>
        <input
          className="form-control mb-2"
          value={server}
          onChange={(e) => setServer(e.target.value)}
          disabled={busy}
        />
        <label className="form-label">Seats</label>
        <input
          type="number"
          min={2}
          max={7}
          className="form-control mb-3"
          value={seats}
          onChange={(e) => setSeats(Math.max(2, Math.min(7, Number(e.target.value))))}
          disabled={busy}
        />
        <button className="btn btn-primary" onClick={() => void create()} disabled={busy}>
          {busy ? 'Creating…' : 'Create room'}
        </button>
        {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
        {result && (
          <div className="mt-4">
            <div className="small text-muted mb-2">Room <code>{result.roomId}</code></div>
            {Array.from({ length: seats }, (_, seat) => (
              <div key={seat} className="mb-2">
                <a href={joinUrl(result, seat)} className="text-decoration-none">
                  Join as seat {seat} →
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
