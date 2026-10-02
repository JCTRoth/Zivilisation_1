/**
 * GameSpeedControls — the game's own speed, as opposed to animation speed.
 *
 * The settings screen elsewhere only scales how *smoothly* things move; this
 * controls how fast the game *plays*. It exists for self-running scenarios,
 * where the game is otherwise a blur with no way to slow it down, take a look
 * at the board, or stop it outright.
 *
 * The ladder is deliberately uniform: step 0 is full speed and every click of
 * "Slower" adds exactly one increment, so the matching "Faster" click undoes
 * exactly what the previous one did and the game always walks back up the same
 * rungs it came down. "Faster" therefore starts out disabled — there is nothing
 * above full speed to move to — and only becomes available once the speed has
 * actually been reduced.
 */

import { Button, Form } from 'react-bootstrap';
import { useGameStore } from '@/stores/GameStore';
import { canGoFaster, canGoSlower, gameSpeedLabel, GAME_SPEED_STEP_COUNT } from '@/data/GameConstants';
import '../../styles/gameSpeedControls.css';

interface GameSpeedControlsProps {
  /** Whether the game is paused right now. */
  isPaused: boolean;
  /** Pause the game while it runs, resume it completely when it is paused. */
  onTogglePause: () => void;
  /** Icon-only single row for the spectator overlay. */
  compact?: boolean;
}

export default function GameSpeedControls({ isPaused, onTogglePause, compact = false }: GameSpeedControlsProps) {
  const step = useGameStore((state) => state.settings.gameSpeedStep ?? 0);
  const actions = useGameStore((state) => state.actions);
  const canFaster = canGoFaster(step);
  const canSlower = canGoSlower(step);

  const buttons = (
    <div className="game-speed__buttons">
      <Button
        variant="outline-light"
        size="sm"
        className="game-speed__button"
        disabled={!canSlower}
        onClick={actions.slowerGameSpeed}
        title="Run the game one step slower"
        aria-label="Slower"
      >
        <span aria-hidden="true">⏪</span>
        {!compact && <span className="game-speed__button-label">Slower</span>}
      </Button>

      <Button
        variant={isPaused ? 'success' : 'outline-light'}
        size="sm"
        className="game-speed__button game-speed__button--play"
        onClick={onTogglePause}
        title={isPaused ? 'Resume the game' : 'Pause the game'}
        aria-label={isPaused ? 'Play' : 'Pause'}
        aria-pressed={isPaused}
      >
        <span aria-hidden="true">{isPaused ? '▶' : '⏸'}</span>
        {!compact && <span className="game-speed__button-label">{isPaused ? 'Play' : 'Pause'}</span>}
      </Button>

      <Button
        variant="outline-light"
        size="sm"
        className="game-speed__button"
        disabled={!canFaster}
        onClick={actions.fasterGameSpeed}
        title={
          canFaster
            ? 'Run the game one step faster'
            : 'Already at full speed'
        }
        aria-label="Faster"
      >
        <span aria-hidden="true">⏩</span>
        {!compact && <span className="game-speed__button-label">Faster</span>}
      </Button>
    </div>
  );

  if (compact) {
    return (
      <div className="game-speed game-speed--compact" data-speed-step={step}>
        <span className="game-speed__readout" title={`Game speed: ${gameSpeedLabel(step)}`}>
          {gameSpeedLabel(step)}
        </span>
        {buttons}
      </div>
    );
  }

  return (
    <div className="settings-control game-speed" data-speed-step={step}>
      <div className="settings-control__header">
        <Form.Label className="settings-control__label">Game Speed</Form.Label>
        <strong className="settings-control__value">{gameSpeedLabel(step)}</strong>
      </div>
      {buttons}
      <Form.Text className="settings-control__hint">
        How fast the game itself runs, independent of animation speed. Each step
        is the same size, so Faster undoes Slower exactly. Full speed is the
        fastest the game can go, so Faster is unavailable until you slow it down.
        {GAME_SPEED_STEP_COUNT > 0 && ` There are ${GAME_SPEED_STEP_COUNT} slower steps.`}
      </Form.Text>
    </div>
  );
}
