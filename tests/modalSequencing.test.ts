import { afterEach, describe, expect, it } from 'vitest';
import { useGameStore } from '@/stores/GameStore';

const cityEvent = (cityId: string) => ({
  kind: 'founded' as const,
  cityId,
  cityName: `City ${cityId}`,
  col: 3,
  row: 4,
  population: 1,
});

function clearCityEvents() {
  useGameStore.getState().actions.clearCityEvents();
}

describe('city modal sequencing', () => {
  afterEach(clearCityEvents);

  it('queues city notices while the city screen is open and shows them afterward', () => {
    const actions = useGameStore.getState().actions;
    actions.showDialog('city-details');
    actions.queueCityEvent(cityEvent('berlin'));

    expect(useGameStore.getState().uiState.activeDialog).toBe('city-details');

    actions.hideDialog();

    const state = useGameStore.getState();
    expect(state.uiState.activeDialog).toBe('city-founded');
    expect(state.cityEventQueue.map((event) => event.cityId)).toEqual(['berlin']);
  });

  it('resumes the next city notice after opening and closing a city from a notice', () => {
    const actions = useGameStore.getState().actions;
    actions.queueCityEvent(cityEvent('berlin'));
    actions.queueCityEvent(cityEvent('hamburg'));

    // Mirrors the city-event "Open City" flow: consume the current notice,
    // then show the selected city's details screen.
    actions.dequeueCityEvent();
    actions.showDialog('city-details');
    expect(useGameStore.getState().uiState.activeDialog).toBe('city-details');

    actions.hideDialog();

    const state = useGameStore.getState();
    expect(state.uiState.activeDialog).toBe('city-founded');
    expect(state.cityEventQueue.map((event) => event.cityId)).toEqual(['hamburg']);
  });
});
