// maze.js — the ONLY pre-baked data in the whole site: the real 9x12
// PointMaze layout from the Q-OIL experiment dump. Everything else
// (Q-values, policies, the optimism bonus) is learned live in the browser.

// 1 = wall, 0 = free.  Row 0 is the top.  (matches pointmaze_qviz_data.npz)
export const MAZE = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1],
  [1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1],
  [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

export const H = MAZE.length;       // 9
export const W = MAZE[0].length;    // 12

export const START = { r: 1, c: 1 };
export const GOAL  = { r: 7, c: 10 };

// Actions: 0=up, 1=down, 2=left, 3=right
export const ACTIONS = [
  { dr: -1, dc: 0 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 },
];
export const NA = ACTIONS.length;

// Map a keyboard key to an action index, or null.
export function keyToAction(key) {
  switch (key) {
    case 'ArrowUp': case 'w': case 'W': return 0;
    case 'ArrowDown': case 's': case 'S': return 1;
    case 'ArrowLeft': case 'a': case 'A': return 2;
    case 'ArrowRight': case 'd': case 'D': return 3;
    default: return null;
  }
}

export function isFree(r, c) {
  return r >= 0 && r < H && c >= 0 && c < W && MAZE[r][c] === 0;
}

export function isWall(r, c) {
  return !(r >= 0 && r < H && c >= 0 && c < W) || MAZE[r][c] === 1;
}

export function isGoal(r, c) {
  return r === GOAL.r && c === GOAL.c;
}

// Deterministic grid step. Moving into a wall keeps the agent in place.
export function step(r, c, a) {
  const { dr, dc } = ACTIONS[a];
  const nr = r + dr, nc = c + dc;
  if (isFree(nr, nc)) return { r: nr, c: nc, moved: true };
  return { r, c, moved: false };
}
