import { describe, it, expect } from 'vitest';
import { AIResearch } from '@/game/engine/AI/AIResearch';

describe('available techs', () => {
  it('a fresh civ only sees techs it can actually research', () => {
    const civ: any = { technologies: ['irrigation', 'mining', 'roads'], personality: {} };
    const avail = AIResearch.getAvailableTechnologies(civ);
    console.log('count', avail.length);
    console.log(avail.join(' '));
    expect(avail).not.toContain('steel');
    expect(avail).not.toContain('moonshot');
  });
});
