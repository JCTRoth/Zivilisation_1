// Canonical data shapes live in `types/game`, like every other AI module here.
// (`../../City` exports the engine class, whose fields are `civilization` etc.,
// and `../../Unit` does not export its class at all.)
import type { City, Unit } from '../../../../types/game';

export interface SettlerWorkAssignment {
  unitId: string;
  targetCol: number;
  targetRow: number;
  improvementType: string;
}

export interface ImprovementNeed {
  col: number;
  row: number;
  improvementType: string;
  priority: number;
}

export class SettlerGovernor {
  private assignments: Map<string, SettlerWorkAssignment> = new Map();
  private improvementQueue: ImprovementNeed[] = [];

  getAssignment(unitId: string): SettlerWorkAssignment | undefined {
    return this.assignments.get(unitId);
  }

  assignWork(unitId: string, targetCol: number, targetRow: number, improvementType: string): void {
    this.assignments.set(unitId, { unitId, targetCol, targetRow, improvementType });
  }

  completeAssignment(unitId: string): void {
    this.assignments.delete(unitId);
  }

  getAssignedCount(): number {
    return this.assignments.size;
  }

  getQueuedImprovements(): ImprovementNeed[] {
    return [...this.improvementQueue];
  }

  queueImprovement(need: ImprovementNeed): void {
    const exists = this.improvementQueue.some(
      (n) => n.col === need.col && n.row === need.row && n.improvementType === need.improvementType,
    );
    if (!exists) {
      this.improvementQueue.push(need);
      this.improvementQueue.sort((a, b) => b.priority - a.priority);
    }
  }

  dequeueImprovement(): ImprovementNeed | undefined {
    return this.improvementQueue.shift();
  }

  getQueueLength(): number {
    return this.improvementQueue.length;
  }

  updateFromCities(cities: City[], units: Unit[]): void {
    const settlers = units.filter(
      (u: Unit) => u.type === 'settler' && !u.isDefeated,
    );

    for (const settler of settlers) {
      if (!this.assignments.has(settler.id)) {
        const target = this.findBestImprovementTarget(settler, cities);
        if (target) {
          this.assignWork(settler.id, target.col, target.row, target.improvementType);
        }
      }
    }

    for (const [unitId, assignment] of this.assignments) {
      const settler = units.find((u: Unit) => u.id === unitId);
      if (!settler || settler.isDefeated) {
        this.assignments.delete(unitId);
        continue;
      }
      if (settler.col === assignment.targetCol && settler.row === assignment.targetRow) {
        this.assignments.delete(unitId);
      }
    }
  }

  private findBestImprovementTarget(
    settler: Unit,
    cities: City[],
  ): { col: number; row: number; improvementType: string } | null {
    let bestTarget: { col: number; row: number; improvementType: string } | null = null;
    let bestScore = -Infinity;

    for (const city of cities) {
      if (city.civilizationId !== settler.civilizationId) continue;

      const cityCenter = `${city.col},${city.row}`;
      const workingTiles = city.workingTiles ?? new Set<string>();

      for (const key of workingTiles) {
        if (key === cityCenter) continue;
        const parts = key.split(',');
        const col = Number(parts[0]);
        const row = Number(parts[1]);
        if (!Number.isFinite(col) || !Number.isFinite(row)) continue;

        const isOccupied = this.assignments.has(`${col},${row}`);
        if (isOccupied) continue;

        const improvementType = this.determineImprovementType(city, col, row);
        if (!improvementType) continue;

        const dist = Math.max(Math.abs(settler.col - col), Math.abs(settler.row - row));
        const score = 100 - dist;
        if (score > bestScore) {
          bestScore = score;
          bestTarget = { col, row, improvementType };
        }
      }
    }

    return bestTarget;
  }

  private determineImprovementType(city: City, col: number, row: number): string | null {
    const tile = (city as unknown as { getTileAt?: (c: number, r: number) => { type?: string; terrain?: string } }).getTileAt?.(col, row);
    if (!tile) return null;

    const terrain = (tile.terrain ?? tile.type ?? '').toLowerCase();

    if (terrain === 'grassland' || terrain === 'plains' || terrain === 'river') {
      return 'irrigation';
    }
    if (terrain === 'hills' || terrain === 'mountains') {
      return 'mines';
    }
    if (terrain === 'desert') {
      return 'irrigation';
    }

    return 'road';
  }

  getRecommendedSettlerCount(cities: City[], units: Unit[]): number {
    if (cities.length === 0) return 0;

    const civId = cities[0].civilizationId;
    const settlers = units.filter(
      (u: Unit) => u.civilizationId === civId && u.type === 'settler' && !u.isDefeated,
    );
    const aliveSettlers = settlers.length;

    const hasMatureCity = cities.some((c: City) => (c.population ?? 0) >= 6);
    const hasValidSettlementSpot = this.hasValidSettlementSpot(cities);

    if (!hasMatureCity || !hasValidSettlementSpot) {
      // Only settlers that are ACTUALLY heading to a site count against the
      // "one at a time" allowance. A settler with no settlement target —
      // blocked by spacing everywhere, reassigned to field works, or stuck —
      // cannot consume it, or the civ stops expanding the moment one settler
      // gets unlucky: the allowance stays full forever while nobody founds,
      // the empire stays at one city, and (in the pinned AI-vs-AI run) it was
      // overrun before it could garrison anything.
      const expanding = settlers.filter((u) => !!u._aiSettlement).length;
      return Math.max(0, 1 - expanding);
    }

    const assignedSettlers = this.getAssignedCount();
    const queuedImprovements = this.getQueueLength();

    const unassignedWork = Math.max(0, queuedImprovements - assignedSettlers);
    const workBasedRecommendation = Math.min(3, Math.ceil(unassignedWork / 2));

    const expansionNeed = cities.length < 5 ? 1 : 0;
    const recommended = Math.max(workBasedRecommendation, expansionNeed);

    return Math.max(0, recommended - aliveSettlers);
  }

  private hasValidSettlementSpot(cities: City[]): boolean {
    return cities.length < 8;
  }
}
