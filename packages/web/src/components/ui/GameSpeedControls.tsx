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
import { useTranslation } from '@/i18n/useTranslation';
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
  // Subscribes the control to language changes (buttons, labels and the
  // gameSpeedLabel readout all follow the active language).
  const { t } = useTranslation();
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
        title={t('speed.slowerTitle')}
        aria-label={t('speed.slower')}
      >
        <span aria-hidden="true">⏪</span>
        {!compact && <span className="game-speed__button-label">{t('speed.slower')}</span>}
      </Button>

      <Button
        variant={isPaused ? 'success' : 'outline-light'}
        size="sm"
        className="game-speed__button game-speed__button--play"
        onClick={onTogglePause}
        title={isPaused ? t('speed.playTitle') : t('speed.pauseTitle')}
        aria-label={isPaused ? t('speed.play') : t('speed.pause')}
        aria-pressed={isPaused}
      >
        <span aria-hidden="true">{isPaused ? '▶' : '⏸'}</span>
        {!compact && (
          <span className="game-speed__button-label">{isPaused ? t('speed.play') : t('speed.pause')}</span>
        )}
      </Button>

      <Button
        variant="outline-light"
        size="sm"
        className="game-speed__button"
        disabled={!canFaster}
        onClick={actions.fasterGameSpeed}
        title={canFaster ? t('speed.fasterTitle') : t('speed.fasterDisabledTitle')}
        aria-label={t('speed.faster')}
      >
        <span aria-hidden="true">⏩</span>
        {!compact && <span className="game-speed__button-label">{t('speed.faster')}</span>}
      </Button>
    </div>
  );

  if (compact) {
    return (
      <div className="game-speed game-speed--compact" data-speed-step={step}>
        <span className="game-speed__readout" title={t('speed.readoutAria', { label: gameSpeedLabel(step) })}>
          {gameSpeedLabel(step)}
        </span>
        {buttons}
      </div>
    );
  }

  return (
    <div className="settings-control game-speed" data-speed-step={step}>
      <div className="settings-control__header">
        <Form.Label className="settings-control__label">{t('speed.label')}</Form.Label>
        <strong className="settings-control__value">{gameSpeedLabel(step)}</strong>
      </div>
      {buttons}
      <Form.Text className="settings-control__hint">
        {t('speed.hint')}
        {GAME_SPEED_STEP_COUNT > 0 && ` ${t('speed.stepsAvailable', { count: GAME_SPEED_STEP_COUNT })}`}
      </Form.Text>
    </div>
  );
}
