// MovementHelper.ts

/**
 * Returns all 8 adjacent tiles in a completely random order.
 * Used to break units out of oscillation loops by trying random directions.
 */
export function getShuffledAdjacentTiles(currentCol: number, currentRow: number): { col: number; row: number }[] {
  const directions = [
    [-1, -1], [0, -1], [1, -1],
    [-1,  0],          [1,  0],
    [-1,  1], [0,  1], [1,  1]
  ];

  // Fisher-Yates shuffle to randomize the directions array
  for (let i = directions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [directions[i], directions[j]] = [directions[j], directions[i]];
  }

  // Map them to actual coordinates and return the array
  return directions.map(dir => ({
    col: currentCol + dir[0],
    row: currentRow + dir[1]
  }));
}