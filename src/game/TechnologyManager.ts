import { Technology } from '../../types/game';
import { TECHNOLOGIES_DATA } from '@/data/TechnologyData';

export class TechnologyManager {
  private technologies: Technology[];

  constructor() {
    // Deep copy the technology data to avoid modifying the original
    this.technologies = JSON.parse(JSON.stringify(TECHNOLOGIES_DATA));
    this.initializeTechnologyAvailability();
  }

  /**
   * Get all technologies
   */
  getAllTechnologies(): Technology[] {
    return [...this.technologies];
  }

  /**
   * Get a technology by ID
   */
  getTechnology(id: string): Technology | undefined {
    return this.technologies.find(tech => tech.id === id);
  }

  /**
   * Get available technologies (not researched, prerequisites met)
   */
  getAvailableTechnologies(): Technology[] {
    return this.technologies.filter(tech => tech.available && !tech.researched);
  }

  /**
   * Get researched technologies
   */
  getResearchedTechnologies(): Technology[] {
    return this.technologies.filter(tech => tech.researched);
  }

  /**
   * Get technologies that are currently being researched
   */
  getResearchingTechnologies(): Technology[] {
    return this.technologies.filter(tech => tech.researching);
  }

  /**
   * Get future technologies (not available yet)
   */
  getFutureTechnologies(): Technology[] {
    return this.technologies.filter(tech => !tech.available && !tech.researched);
  }

  /**
   * Check if a technology can be researched (prerequisites met)
   */
  canResearchTechnology(techId: string): boolean {
    const tech = this.getTechnology(techId);
    if (!tech) return false;

    // Check if all prerequisites are researched
    return tech.prerequisites.every(prereqId => {
      const prereqTech = this.getTechnology(prereqId);
      return prereqTech?.researched || false;
    });
  }

  /**
   * Set a technology as being researched
   */
  setResearching(techId: string, researching: boolean): void {
    const tech = this.getTechnology(techId);
    if (tech) {
      // Stop any currently researching tech
      this.technologies.forEach(t => t.researching = false);
      // Set the new tech as researching
      tech.researching = researching;
    }
  }

  /**
   * Mark a technology as researched
   */
  researchTechnology(techId: string): void {
    const tech = this.getTechnology(techId);
    if (tech && this.canResearchTechnology(techId)) {
      tech.researched = true;
      tech.researching = false;
      tech.available = true;

      // Update availability of dependent technologies
      this.updateTechnologyAvailability();
    }
  }

  /**
   * Initialize technology availability based on prerequisites
   */
  private initializeTechnologyAvailability(): void {
    this.technologies.forEach(tech => {
      if (tech.prerequisites.length === 0) {
        tech.available = true;
      } else {
        tech.available = this.canResearchTechnology(tech.id);
      }
    });
  }

  /**
   * Update technology availability after researching a tech
   */
  private updateTechnologyAvailability(): void {
    this.technologies.forEach(tech => {
      if (!tech.researched) {
        tech.available = this.canResearchTechnology(tech.id);
      }
    });
  }

  /**
   * Reset all technologies to initial state
   */
  reset(): void {
    this.technologies.forEach(tech => {
      tech.researched = false;
      tech.researching = false;
    });
    this.initializeTechnologyAvailability();
  }
}

/**
 * Extended TechnologyManager with additional features
 */
export class ExtendedTechnologyManager extends TechnologyManager {
  private researchProgress: Map<string, number> = new Map();
  private researchQueue: string[] = [];

  /**
   * Get research progress for a technology (0-100)
   */
  getResearchProgress(techId: string): number {
    return this.researchProgress.get(techId) || 0;
  }

  /**
   * Set research progress for a technology
   */
  setResearchProgress(techId: string, progress: number): void {
    this.researchProgress.set(techId, Math.max(0, Math.min(100, progress)));
  }

  /**
   * Add science points to current research
   */
  addSciencePoints(points: number): boolean {
    const researchingTech = this.getResearchingTechnologies()[0];
    if (!researchingTech) return false;

    const currentProgress = this.getResearchProgress(researchingTech.id);
    const newProgress = currentProgress + (points / researchingTech.cost!) * 100;

    if (newProgress >= 100) {
      this.researchTechnology(researchingTech.id);
      this.researchProgress.delete(researchingTech.id);
      return true; // Technology completed
    } else {
      this.setResearchProgress(researchingTech.id, newProgress);
      return false; // Still researching
    }
  }

  /**
   * Get the current research target
   */
  getCurrentResearch(): Technology | null {
    const researching = this.getResearchingTechnologies();
    return researching.length > 0 ? researching[0] : null;
  }

  /**
   * Get technologies grouped by era
   */
  getTechnologiesByEra(): Record<string, Technology[]> {
    const eras: Record<string, Technology[]> = {};

    this.getAllTechnologies().forEach(tech => {
      const era = this.getTechnologyEra(tech.id);
      if (!eras[era]) {
        eras[era] = [];
      }
      eras[era].push(tech);
    });

    return eras;
  }

  /**
   * Determine the era of a technology based on its prerequisites depth
   */
  private getTechnologyEra(techId: string): string {
    const tech = this.getTechnology(techId);
    if (!tech) return 'unknown';

    const depth = this.getPrerequisiteDepth(techId);
    if (depth === 0) return 'ancient';
    if (depth === 1) return 'classical';
    if (depth === 2) return 'medieval';
    return 'renaissance';
  }

  /**
   * Calculate how deep in the tech tree a technology is
   */
  private getPrerequisiteDepth(techId: string, visited: Set<string> = new Set()): number {
    const tech = this.getTechnology(techId);
    if (!tech || visited.has(techId)) return 0;

    visited.add(techId);

    if (tech.prerequisites.length === 0) return 0;

    const depths = tech.prerequisites.map(prereq =>
      this.getPrerequisiteDepth(prereq, new Set(visited))
    );

    return Math.max(...depths) + 1;
  }

  /**
   * Get technology tree as a graph structure
   */
  getTechnologyTree(): Record<string, { tech: Technology; children: string[] }> {
    const tree: Record<string, { tech: Technology; children: string[] }> = {};

    this.getAllTechnologies().forEach(tech => {
      tree[tech.id] = {
        tech: { ...tech },
        children: []
      };
    });

    // Build parent-child relationships
    this.getAllTechnologies().forEach(tech => {
      tech.prerequisites.forEach(prereq => {
        if (tree[prereq]) {
          tree[prereq].children.push(tech.id);
        }
      });
    });

    return tree;
  }

  /**
   * Override reset to also clear progress and queue
   */
  reset(): void {
    super.reset();
    this.researchProgress.clear();
    this.researchQueue = [];
  }

  /**
   * Get the total science cost of all researched technologies
   */
  getTotalScienceInvested(): number {
    return this.getResearchedTechnologies().reduce((total, tech) => total + (tech.cost || 0), 0);
  }

  /**
   * Get technology completion percentage
   */
  getCompletionPercentage(): number {
    const total = this.getAllTechnologies().length;
    const researched = this.getResearchedTechnologies().length;
    return total > 0 ? (researched / total) * 100 : 0;
  }
}

// Export a singleton instance
export const technologyManager = new TechnologyManager();
export const extendedTechnologyManager = new ExtendedTechnologyManager();