// Research path helpers — the ordered chain of techs from the tree roots to a
// target tech (via prerequisites). Used by the tech tree and research selection.
import type { Technology } from '../../types/game';

/**
 * Return an ordered path [root, …, targetId] following prerequisite edges.
 * Returns null when the target cannot be reached from any root tech.
 */
export function findPathToTech(techs: Technology[], targetId: string): string[] | null {
  if (!techs || techs.length === 0) return null;

  const childrenMap: Record<string, string[]> = {};
  techs.forEach((t) => {
    (t.prerequisites || []).forEach((p) => {
      if (!childrenMap[p]) childrenMap[p] = [];
      childrenMap[p].push(t.id);
    });
  });

  const roots = techs
    .filter((t) => !t.prerequisites || t.prerequisites.length === 0)
    .map((t) => t.id);

  const visited = new Set<string>();
  const stack: string[] = [];

  const dfs = (nodeId: string): boolean => {
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    stack.push(nodeId);
    if (nodeId === targetId) return true;
    const children = childrenMap[nodeId] || [];
    for (const c of children) {
      if (dfs(c)) return true;
    }
    stack.pop();
    return false;
  };

  for (const root of roots) {
    visited.clear();
    stack.length = 0;
    if (dfs(root)) return [...stack];
  }
  return null;
}

/**
 * The first tech in `path` that is available and not yet researched — the next
 * tech a civ should start (or continue) researching. Returns null when the
 * path is exhausted or empty.
 *
 * `researchedIds` (optional) is the CIV's own researched tech list. The shared
 * tree's `researched` flag is the union across all civilizations, so it must
 * not be used to decide what a specific civ can still research — otherwise a
 * tech another civ discovered first would be silently skipped/locked here.
 */
export function firstUnresearchedInPath(
  techs: Technology[],
  path: string[],
  researchedIds?: Set<string>,
): string | null {
  for (const id of path) {
    const t = techs.find((x) => x.id === id);
    if (!t) continue;
    if (researchedIds) {
      // Civ-scoped: only skip what THIS civ already has (the engine gates the
      // prerequisites when the research is actually set).
      if (!researchedIds.has(String(id))) return id;
    } else if (t.available && !t.researched) {
      return id;
    }
  }
  return null;
}

/**
 * The first tech in `path` that THIS civ can actually start: it is not in the
 * civ's own researched list yet and every prerequisite is already researched
 * by the civ.
 *
 * The shared `technologies` tree is a UNION across all civilizations — its
 * `researched` flag turns true when ANY civ discovers a tech and its
 * `available` flag unlocks on ANY civ's progress. Using those flags to pick
 * what a specific civ may research made techs an AI discovered first
 * unselectable for the player (bug report: "I can't select the top-level
 * technologies any more").
 */
export function firstResearchableInPath(
  techs: Technology[],
  path: string[],
  civTechIds: Set<string>,
): string | null {
  for (const id of path) {
    const t = techs.find((x) => x.id === id);
    if (!t || civTechIds.has(String(t.id))) continue;
    const prereqs = t.prerequisites ?? [];
    if (prereqs.length === 0 || prereqs.every((p) => civTechIds.has(String(p)))) {
      return String(t.id);
    }
  }
  return null;
}
