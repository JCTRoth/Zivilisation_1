/**
 * ScoutMemory - Persistence layer for scout discoveries
 * Phase 3.1: Scout Persistence Across Turns
 * 
 * Tracks discovered enemy locations across turns and manages
 * stale discoveries that need re-exploration.
 */

import { EnemyLocation } from './EnemySearcher';

interface DiscoveryRecord extends EnemyLocation {
  lastSeenRound: number;
  confirmationCount: number; // How many times this location has been confirmed
}

export class ScoutMemory {
  private discoveries: Map<number, DiscoveryRecord[]> = new Map(); // enemyCivId -> discoveries
  private currentRound: number = 0;
  
  /**
   * Update the current round number for age tracking
   */
  public setCurrentRound(round: number): void {
    this.currentRound = round;
  }
  
  /**
   * Record a new discovery or update an existing one
   */
  public recordDiscovery(enemyCivId: number, location: EnemyLocation): void {
    if (!this.discoveries.has(enemyCivId)) {
      this.discoveries.set(enemyCivId, []);
    }
    
    const civDiscoveries = this.discoveries.get(enemyCivId)!;
    
    // Check if this location already exists
    const existingIndex = civDiscoveries.findIndex(
      d => d.col === location.col && d.row === location.row && d.type === location.type
    );
    
    if (existingIndex >= 0) {
      // Update existing discovery
      civDiscoveries[existingIndex].lastSeenRound = this.currentRound;
      civDiscoveries[existingIndex].confirmationCount++;
      console.log(`[SCOUT-MEMORY] Updated discovery: ${location.type} at (${location.col}, ${location.row}), confirmations: ${civDiscoveries[existingIndex].confirmationCount}`);
    } else {
      // Add new discovery
      const record: DiscoveryRecord = {
        ...location,
        lastSeenRound: this.currentRound,
        confirmationCount: 1
      };
      civDiscoveries.push(record);
      console.log(`[SCOUT-MEMORY] New discovery: ${location.type} at (${location.col}, ${location.row})`);
    }
  }
  
  /**
   * Get all discoveries for a specific enemy civilization
   */
  public getDiscoveries(enemyCivId: number): DiscoveryRecord[] {
    return this.discoveries.get(enemyCivId) || [];
  }
  
  /**
   * Get the nearest unexplored target (location not visited recently)
   * @param fromCol Starting column position
   * @param fromRow Starting row position
   * @param enemyCivId Enemy civilization to search for
   * @param maxAge Maximum age in rounds before a location is considered stale
   */
  public getNearestUnexploredTarget(
    fromCol: number, 
    fromRow: number, 
    enemyCivId: number,
    maxAge: number = 10
  ): EnemyLocation | null {
    const civDiscoveries = this.discoveries.get(enemyCivId);
    if (!civDiscoveries || civDiscoveries.length === 0) {
      return null;
    }
    
    // Filter to stale locations (not visited recently)
    const staleLocations = civDiscoveries.filter(
      d => (this.currentRound - d.lastSeenRound) >= maxAge
    );
    
    if (staleLocations.length === 0) {
      return null;
    }
    
    // Find nearest stale location
    let nearestLocation: EnemyLocation | null = null;
    let minDistance = Infinity;
    
    for (const location of staleLocations) {
      const distance = Math.abs(location.col - fromCol) + Math.abs(location.row - fromRow);
      if (distance < minDistance) {
        minDistance = distance;
        nearestLocation = location;
      }
    }
    
    if (nearestLocation) {
      console.log(`[SCOUT-MEMORY] Found stale target at (${nearestLocation.col}, ${nearestLocation.row}), age: ${this.currentRound - (nearestLocation as DiscoveryRecord).lastSeenRound} rounds`);
    }
    
    return nearestLocation;
  }

  
  /**
   * Get statistics about stored discoveries
   */
  public getStats(): { totalDiscoveries: number; byType: Record<string, number> } {
    let totalDiscoveries = 0;
    const byType: Record<string, number> = {};
    
    for (const civDiscoveries of this.discoveries.values()) {
      totalDiscoveries += civDiscoveries.length;
      
      for (const discovery of civDiscoveries) {
        byType[discovery.type] = (byType[discovery.type] || 0) + 1;
      }
    }
    
    return { totalDiscoveries, byType };
  }

  /**
   * Remove a recorded discovery for an enemy civilization at a specific position and type
   * Returns true if a discovery was removed
   */
  public removeDiscovery(enemyCivId: number, col: number, row: number, type: string): boolean {
    const civDiscoveries = this.discoveries.get(enemyCivId);
    if (!civDiscoveries) return false;

    const idx = civDiscoveries.findIndex(d => d.col === col && d.row === row && d.type === type);
    if (idx >= 0) {
      civDiscoveries.splice(idx, 1);
      console.log(`[SCOUT-MEMORY] Removed discovery: ${type} at (${col}, ${row}) for civ ${enemyCivId}`);
      return true;
    }

    return false;
  }
  
  /**
   * Clear all discoveries (for testing or reset)
   */
  public clear(): void {
    this.discoveries.clear();
    console.log(`[SCOUT-MEMORY] Cleared all discoveries`);
  }
}
