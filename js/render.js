// render.js — canvas drawing for the two panels.
import { MAZE, H, W, START, GOAL, isFree } from './maze.js';

// Value colorscale (indigo -> teal -> terracotta -> gold), matching the paper figures.
const HEAT_STOPS = [
  [0.00, [0x24, 0x3a, 0x5e]],
  [0.38, [0x2f, 0x7d, 0x8c]],
  [0.66, [0xcf, 0x8e, 0x5e]],
  [1.00, [0xf0, 0xd2, 0x7a]],
];

export function valueColor(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    const [t0, c0] = HEAT_STOPS[i];
    const [t1, c1] = HEAT_STOPS[i + 1];
    if (t <= t1) {
      const f = (t - t0) / Math.max(t1 - t0, 1e-6);
      const r = Math.round(c0[0] + f * (c1[0] - c0[0]));
      const g = Math.round(c0[1] + f * (c1[1] - c0[1]));
      const b = Math.round(c0[2] + f * (c1[2] - c0[2]));
      return `rgb(${r},${g},${b})`;
    }
  }
  const last = HEAT_STOPS[HEAT_STOPS.length - 1][1];
  return `rgb(${last[0]},${last[1]},${last[2]})`;
}

export const COLORS = {
  policy: '#5b9be8',
  human: '#c77dff',
  goal: '#f0c860',
  bonus: '#e08e4f',
  wall: '#2b2d3a',
  freeStroke: 'rgba(120,130,160,0.18)',
  envBg: '#11131c',
  optPath: '#f4f1ea',
};

// Geometry helper: fit a HxW grid into a canvas, centered, with padding.
export function gridGeom(canvas, pad = 10) {
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const cell = Math.floor(Math.min((cssW - 2 * pad) / W, (cssH - 2 * pad) / H));
  const gw = cell * W, gh = cell * H;
  const ox = Math.round((cssW - gw) / 2);
  const oy = Math.round((cssH - gh) / 2);
  return { cell, ox, oy, gw, gh };
}

export function setupHiDPI(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function cellCenter(g, r, c) {
  return { x: g.ox + c * g.cell + g.cell / 2, y: g.oy + r * g.cell + g.cell / 2 };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawStar(ctx, x, y, rOuter, color) {
  const spikes = 5, rInner = rOuter * 0.45;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const rad = (i % 2 === 0) ? rOuter : rInner;
    const ang = (Math.PI / spikes) * i - Math.PI / 2;
    const px = x + Math.cos(ang) * rad;
    const py = y + Math.sin(ang) * rad;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.shadowColor = color; ctx.shadowBlur = 12;
  ctx.fill();
  ctx.shadowBlur = 0;
}

// ---------------------------------------------------------------------------
// Base maze (walls + grid), shared by both panels.
function drawMazeBase(ctx, g, { heat = null, vrange = null } = {}) {
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const x = g.ox + c * g.cell, y = g.oy + r * g.cell;
      if (MAZE[r][c] === 1) {
        ctx.fillStyle = COLORS.wall;
        roundRect(ctx, x + 0.5, y + 0.5, g.cell - 1, g.cell - 1, Math.min(4, g.cell * 0.18));
        ctx.fill();
      } else {
        if (heat) {
          let v = heat[r][c];
          let t = 0;
          if (vrange && isFinite(v)) {
            const span = vrange.hi - vrange.lo;
            t = span > 1e-6 ? (v - vrange.lo) / span : 0;
          }
          ctx.fillStyle = isFinite(v) ? valueColor(t) : COLORS.envBg;
          ctx.fillRect(x, y, g.cell, g.cell);
        } else {
          ctx.fillStyle = COLORS.envBg;
          ctx.fillRect(x, y, g.cell, g.cell);
          ctx.strokeStyle = COLORS.freeStroke;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, g.cell - 1, g.cell - 1);
        }
      }
    }
  }
}

function drawGoalStart(ctx, g) {
  const goal = cellCenter(g, GOAL.r, GOAL.c);
  drawStar(ctx, goal.x, goal.y, g.cell * 0.34, COLORS.goal);
  const st = cellCenter(g, START.r, START.c);
  ctx.beginPath();
  ctx.arc(st.x, st.y, g.cell * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(244,241,234,0.8)';
  ctx.fill();
}

// ---------------------------------------------------------------------------
// ENV PANEL: maze + live policy/intervention rollout trail + agent.
export function drawEnv(ctx, g, { trail, agentPos, intervActive }) {
  ctx.clearRect(0, 0, g.ox * 2 + g.gw + 40, g.oy * 2 + g.gh + 40);
  drawMazeBase(ctx, g);
  drawGoalStart(ctx, g);

  // trail: list of {r,c,interv}
  if (trail && trail.length > 1) {
    for (let i = 1; i < trail.length; i++) {
      const a = cellCenter(g, trail[i - 1].r, trail[i - 1].c);
      const b = cellCenter(g, trail[i].r, trail[i].c);
      const age = (trail.length - i) / trail.length;     // 0 newest .. 1 oldest
      const alpha = 0.18 + 0.72 * (1 - age);
      ctx.strokeStyle = (trail[i].interv ? hexA(COLORS.human, alpha) : hexA(COLORS.policy, alpha));
      ctx.lineWidth = Math.max(2, g.cell * 0.16);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  // agent
  if (agentPos) {
    const p = { x: g.ox + agentPos.c * g.cell + g.cell / 2,
                y: g.oy + agentPos.r * g.cell + g.cell / 2 };
    const col = intervActive ? COLORS.human : COLORS.policy;
    ctx.beginPath();
    ctx.arc(p.x, p.y, g.cell * 0.30, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = intervActive ? 18 : 10;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// VALUE PANEL: Q heatmap + greedy "optimal" trajectory + bonus markers.
export function drawValue(ctx, g, { heat, vrange, path, bonusCells }) {
  ctx.clearRect(0, 0, g.ox * 2 + g.gw + 40, g.oy * 2 + g.gh + 40);
  drawMazeBase(ctx, g, { heat, vrange });

  // optimism-bonus markers (intervention cells)
  if (bonusCells && bonusCells.size) {
    for (const key of bonusCells) {
      const [r, c] = key.split(',').map(Number);
      const p = cellCenter(g, r, c);
      ctx.beginPath();
      ctx.arc(p.x, p.y, g.cell * 0.13, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.bonus;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  drawGoalStart(ctx, g);

  // greedy / optimal path under this value function
  if (path && path.length > 1) {
    ctx.strokeStyle = COLORS.optPath;
    ctx.lineWidth = Math.max(2.5, g.cell * 0.14);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 4;
    ctx.beginPath();
    const p0 = cellCenter(g, path[0].r, path[0].c);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < path.length; i++) {
      const p = cellCenter(g, path[i].r, path[i].c);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    // arrow head
    const last = cellCenter(g, path[path.length - 1].r, path[path.length - 1].c);
    ctx.beginPath();
    ctx.arc(last.x, last.y, g.cell * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.optPath;
    ctx.fill();
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
