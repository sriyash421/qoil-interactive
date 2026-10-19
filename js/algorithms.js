// algorithms.js — three live tabular learners, trained online in the browser.
//
// The ONLY difference between them is how they treat HUMAN INTERVENTIONS:
//
//   HIL  ............... interventions go in the replay buffer, NO optimism
//                        bonus. Pure task reward. (Luo et al.)
//   Q-OIL (no decoup.) . a single critic gets the optimism bonus +b on
//                        intervention transitions. The bonus bootstraps
//                        BACKWARD through max -> over-optimism blow-up.
//   Q-OIL .............. DECOUPLED critics. A task critic (no bonus) and an
//                        optimistic critic that gets +b but BOOTSTRAPS FROM
//                        THE TASK CRITIC, confining the bonus to intervention
//                        states. The actor follows the optimistic critic.
//
// All three share the same intervention replay buffer, so the comparison is a
// clean ablation: HIL = no bonus, no-decoupling = bonus, Q-OIL = bonus+decouple.

import { H, W, NA, ACTIONS, START, GOAL, isFree, isGoal } from './maze.js';

export const MODES = {
  HIL: 'hil',
  QOIL: 'qoil',
  QOIL_NODEC: 'qoil_nodec',
};

export const MODE_INFO = {
  hil:        { label: 'HIL',                  short: 'HIL',  hasBonus: false, decoupled: false },
  qoil_nodec: { label: 'Q-OIL (no decoupling)', short: 'no-dec', hasBonus: true,  decoupled: false },
  qoil:       { label: 'Q-OIL',                short: 'Q-OIL', hasBonus: true,  decoupled: true },
};

const GOAL_REWARD = 1.0;

function zeros3() {
  // [H][W][NA]
  const t = new Array(H);
  for (let r = 0; r < H; r++) {
    t[r] = new Array(W);
    for (let c = 0; c < W; c++) t[r][c] = new Float64Array(NA);
  }
  return t;
}

function maxA(q) {
  let m = -Infinity;
  for (let a = 0; a < NA; a++) if (q[a] > m) m = q[a];
  return m;
}
function argmaxA(q) {
  let m = -Infinity, bi = 0;
  for (let a = 0; a < NA; a++) if (q[a] > m) { m = q[a]; bi = a; }
  return bi;
}

export class Learner {
  constructor(mode, params = {}) {
    this.mode = mode;
    this.info = MODE_INFO[mode];
    this.alpha = params.alpha ?? 0.55;
    this.gamma = params.gamma ?? 0.97;
    this.epsilon = params.epsilon ?? 0.22;
    this.epsilonMin = params.epsilonMin ?? 0.04;
    this.epsilonDecay = params.epsilonDecay ?? 0.9997;
    this.bonus = params.bonus ?? 1.0;      // base optimism bonus +b
    this.replayK = params.replayK ?? 8;
    this.maxEpSteps = params.maxEpSteps ?? 120;

    // Critics. nodec/hil use Q. qoil uses Qtask + Qopt.
    this.Q = zeros3();
    this.Qtask = zeros3();
    this.Qopt = zeros3();

    // Shared intervention replay buffer.
    this.buffer = [];
    this.bufferMax = 4000;

    // Bookkeeping
    this.envSteps = 0;
    this.episodes = 0;
    this.interventions = 0;
    this.recentResults = [];            // 1 success / 0 fail, last N episodes
    this.recentInterv = 0;              // EMA-ish recent intervention activity

    // Agent position (current episode)
    this.pos = { ...START };
    this.epSteps = 0;
  }

  // ---- which critic does the actor / display read? ---------------------
  actingQ(r, c) {
    if (this.mode === MODES.QOIL) return this.Qopt[r][c];
    return this.Q[r][c];
  }
  // a named critic grid for display (qoil can show task vs optimistic)
  critic(name) {
    if (this.mode === MODES.QOIL) return name === 'task' ? this.Qtask : this.Qopt;
    return this.Q;
  }

  // Value (max over actions) grid for the displayed critic; walls -> NaN.
  valueGrid(name = 'opt') {
    const crit = this.critic(name);
    const V = new Array(H);
    for (let r = 0; r < H; r++) {
      V[r] = new Float64Array(W);
      for (let c = 0; c < W; c++) {
        V[r][c] = isFree(r, c) ? maxA(crit[r][c]) : NaN;
      }
    }
    return V;
  }

  // raw value range of displayed critic (exposes over-optimism blow-up)
  valueRange(name = 'opt') {
    const crit = this.critic(name);
    let lo = Infinity, hi = -Infinity;
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++)
        if (isFree(r, c)) {
          const v = maxA(crit[r][c]);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
    if (!isFinite(lo)) { lo = 0; hi = 0; }
    return { lo, hi };
  }

  // ---- policy: epsilon-greedy on the acting critic --------------------
  policyAction(r, c, greedy = false) {
    if (!greedy && Math.random() < this.epsilon) {
      return Math.floor(Math.random() * NA);
    }
    return argmaxA(this.actingQ(r, c));
  }

  // effective bonus, scaled by recent intervention activity so it "fades"
  // as the human stops intervening (transient rise -> converge).
  effectiveBonus() {
    return this.bonus;
  }

  // ---- TD updates -----------------------------------------------------
  _td(crit, bootCrit, r, c, a, rew, nr, nc, done, bonusOn) {
    const target = done
      ? rew + bonusOn
      : rew + bonusOn + this.gamma * maxA(bootCrit[nr][nc]);
    crit[r][c][a] += this.alpha * (target - crit[r][c][a]);
  }

  learnTransition(r, c, a, rew, nr, nc, done, isInterv) {
    const b = isInterv ? this.effectiveBonus() : 0.0;
    if (this.mode === MODES.QOIL) {
      // task critic: never sees the bonus
      this._td(this.Qtask, this.Qtask, r, c, a, rew, nr, nc, done, 0.0);
      // optimistic critic: gets bonus, but bootstraps from TASK critic
      this._td(this.Qopt, this.Qtask, r, c, a, rew, nr, nc, done, b);
    } else if (this.mode === MODES.QOIL_NODEC) {
      // single critic, bonus bootstraps through itself -> over-optimism
      this._td(this.Q, this.Q, r, c, a, rew, nr, nc, done, b);
    } else { // HIL
      // single critic, no bonus ever
      this._td(this.Q, this.Q, r, c, a, rew, nr, nc, done, 0.0);
    }
  }

  _replay() {
    if (this.buffer.length === 0) return;
    for (let k = 0; k < this.replayK; k++) {
      const t = this.buffer[(Math.random() * this.buffer.length) | 0];
      this.learnTransition(t.r, t.c, t.a, t.rew, t.nr, t.nc, t.done, t.isInterv);
    }
  }

  // ---- one environment step -------------------------------------------
  // humanAction: action index if the human is intervening this step, else null.
  // returns {prev, next, isInterv, done, reachedGoal}
  stepOnce(humanAction) {
    const r = this.pos.r, c = this.pos.c;
    const isInterv = humanAction !== null && humanAction !== undefined;
    let a;
    if (isInterv) {
      a = humanAction;
    } else {
      a = this.policyAction(r, c);
    }

    // env dynamics
    const { dr, dc } = ACTIONS[a];
    let nr = r + dr, nc = c + dc;
    if (!isFree(nr, nc)) { nr = r; nc = c; }   // wall -> stay

    const reachedGoal = isGoal(nr, nc);
    const rew = reachedGoal ? GOAL_REWARD : 0.0;
    const timeout = this.epSteps + 1 >= this.maxEpSteps;
    const done = reachedGoal;                  // terminal only at goal

    // online update on the experienced transition
    this.learnTransition(r, c, a, rew, nr, nc, done, isInterv);

    // store interventions for replay (shared buffer)
    if (isInterv) {
      this.interventions++;
      this.recentInterv = Math.min(1, this.recentInterv + 0.15);
      this.buffer.push({ r, c, a, rew, nr, nc, done, isInterv: true });
      if (this.buffer.length > this.bufferMax) this.buffer.shift();
    } else {
      this.recentInterv *= 0.985;
    }

    // a few replay updates from the human buffer each step
    this._replay();

    // advance
    this.envSteps++;
    this.epSteps++;
    this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
    this.pos = { r: nr, c: nc };

    let episodeEnded = false;
    if (reachedGoal || timeout) {
      episodeEnded = true;
      this.episodes++;
      this.recentResults.push(reachedGoal ? 1 : 0);
      if (this.recentResults.length > 30) this.recentResults.shift();
      this.pos = { ...START };
      this.epSteps = 0;
    }

    return { prev: { r, c }, next: { r: nr, c: nc }, action: a,
             isInterv, reachedGoal, episodeEnded };
  }

  successRate() {
    if (this.recentResults.length === 0) return 0;
    const s = this.recentResults.reduce((a, b) => a + b, 0);
    return s / this.recentResults.length;
  }

  // ---- greedy / "optimal" trajectory under the displayed critic -------
  greedyPath(name = 'opt', maxLen = 80) {
    const crit = this.critic(name);
    let cur = { ...START };
    const path = [{ ...cur }];
    const seen = new Set([cur.r + ',' + cur.c]);
    for (let i = 0; i < maxLen; i++) {
      if (isGoal(cur.r, cur.c)) break;
      const q = crit[cur.r][cur.c];
      // rank actions by Q, take best that leads to a free, unvisited cell
      const order = [0, 1, 2, 3].sort((x, y) => q[y] - q[x]);
      let moved = false;
      for (const a of order) {
        const { dr, dc } = ACTIONS[a];
        const nr = cur.r + dr, nc = cur.c + dc;
        const key = nr + ',' + nc;
        if (isFree(nr, nc) && !seen.has(key)) {
          cur = { r: nr, c: nc };
          seen.add(key);
          path.push({ ...cur });
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
    return path;
  }
}
