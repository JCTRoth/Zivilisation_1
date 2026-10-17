/**
 * CaravanMemory — persistent route-partner memory for caravans.
 */
import { describe, it, expect } from 'vitest';
import { CaravanMemory } from '@/game/engine/AI/CaravanMemory';

describe('CaravanMemory partnership tracking', () => {
  it('records an attempt and starts with zero deliveries', () => {
    const m = new CaravanMemory();
    m.recordTurn(1);
    const e = m.recordAttempt('h1', 'd1', 2);
    expect(e.attempts).toBe(1);
    expect(e.deliveries).toBe(0);
    expect(m.getLedger().attempts).toBe(1);
    expect(m.getDeliverySuccessRate()).toBe(0);
  });

  it('records a successful delivery and updates ledger/partner', () => {
    const m = new CaravanMemory();
    m.recordTurn(1);
    m.recordAttempt('h1', 'd1', 2);
    const d = m.recordDelivery({ homeCityId: 'h1', destCityId: 'd1', destCivId: 2, gold: 50, science: 50, transitTurns: 3 });
    expect(d.deliveries).toBe(1);
    expect(d.totalGold).toBe(50);
    expect(d.bestTransitTurns).toBe(3);
    expect(d.lastDeliveryTurn).toBe(1);
    expect(m.getPartner('h1', 'd1')?.deliveries).toBe(1);
    expect(m.getLedger().deliveries).toBe(1);
    expect(m.isBlacklisted('h1', 'd1')).toBe(false);
  });

  it('records a failed mission (timeout)', () => {
    const m = new CaravanMemory();
    m.recordTurn(1);
    m.recordAttempt('h1', 'd1', 2);
    const f = m.recordFailure('h1', 'd1', 2, 'transit_deadline', 5);
    expect(f.timeouts).toBe(1);
    expect(f.lastFailureReason).toBe('transit_deadline');
    expect(m.getLedger().timeouts).toBe(1);
  });

  it('blacklists a route and enforces TTL expiry', () => {
    const m = new CaravanMemory({ blacklistTtlTurns: 3 });
    m.recordTurn(1);
    m.blacklist('h1', 'd1', 2, 'transit_deadline');
    expect(m.isBlacklisted('h1', 'd1')).toBe(true);
    m.recordTurn(5); // 4 turns later > TTL 3
    expect(m.isBlacklisted('h1', 'd1')).toBe(false);
  });

  it('differentiates partners: blacklist is per-pair, not global', () => {
    const m = new CaravanMemory();
    m.recordTurn(1);
    m.blacklist('h1', 'd1', 2);
    expect(m.isBlacklisted('h1', 'd1')).toBe(true);
    expect(m.isBlacklisted('h1', 'd2')).toBe(false);
  });

  it('rankPartners: drops blacklisted and boosts proven-fast partners', () => {
    const m = new CaravanMemory();
    m.recordTurn(1);
    m.recordAttempt('h1', 'd1', 2);
    m.recordDelivery({ homeCityId: 'h1', destCityId: 'd1', destCivId: 2, gold: 50, science: 50, transitTurns: 2 });
    m.recordAttempt('h2', 'd2', 3); // attempted but never delivered
    // second attempt failed
    m.recordFailure('h2', 'd2', 3, 'no_route_patience', 3);
    m.blacklist('h1', 'd3', 4); // blacklisted partner

    const ranked = m.rankPartners([
      { id: 'a', homeCityId: 'h1', destCityId: 'd1', destCivId: 2, baselineValuePerTurn: 10, foreign: true },
      { id: 'b', homeCityId: 'h2', destCityId: 'd2', destCivId: 3, baselineValuePerTurn: 10, foreign: true },
      { id: 'c', homeCityId: 'h1', destCityId: 'd3', destCivId: 4, baselineValuePerTurn: 10, foreign: true },
    ]);

    // blacklisted partner 'c' dropped
    expect(ranked.find((r) => r.id === 'c')).toBeUndefined();
    // proven-fast partner 'a' ranks above the failed 'b'
    expect(ranked[0].id).toBe('a');
    expect(ranked[0].memoryReason).toContain('proven');
    expect(ranked[1].memoryReason).toContain('always-failed');
  });

  it('getDeliverySuccessRate and aggressiveness reflect delivery failures', () => {
    const m = new CaravanMemory();
    m.recordTurn(1);
    for (let i = 0; i < 5; i++) {
      m.recordAttempt('h1', `d${i}`, 2);
      m.recordDelivery({ homeCityId: 'h1', destCityId: `d${i}`, destCivId: 2, gold: 30, science: 30, transitTurns: 2 });
    }
    expect(m.getDeliverySuccessRate()).toBe(1.0);
    expect(m.getCaravanAggressiveness()).toBe(1.0);

    // Now 5 timeouts -> 100% failure on those -> mixed rate.
    for (let i = 0; i < 5; i++) {
      m.recordAttempt('h2', `x${i}`, 2);
      m.recordFailure(`h2`, `x${i}`, 2, 'transit_deadline', 4);
    }
    expect(m.getDeliverySuccessRate()).toBeLessThan(0.7);
    expect(m.getLedger().timeouts).toBe(5);
  });

  it('prunes stale partner entries past TTL (unless blacklisted)', () => {
    const m = new CaravanMemory({ partnerTtlTurns: 5, maxPartners: 100 });
    m.recordTurn(1);
    m.recordAttempt('h1', 'd1', 2);
    // No delivery, blacklisted -> should NOT be pruned.
    m.blacklist('h1', 'd1', 2);
    m.recordTurn(100);
    expect(m.getPartner('h1', 'd1')).not.toBeNull();

    m.recordTurn(1);
    m.recordAttempt('h1', 'd2', 2);
    m.recordTurn(100);
    expect(m.getPartner('h1', 'd2')).toBeNull();
  });

  it('counts unique remembered partners', () => {
    const m = new CaravanMemory();
    m.recordTurn(1);
    m.recordAttempt('h1', 'd1', 2);
    m.recordAttempt('h1', 'd2', 2);
    m.recordAttempt('h1', 'd1', 2);
    expect(m.getPartnerCount()).toBe(2);
  });
});
