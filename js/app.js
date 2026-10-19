// app.js — ties the live learners to the two panels, controls and keyboard.
import { keyToAction, START, ACTIONS, isFree } from './maze.js';
import { Learner, MODES, MODE_INFO } from './algorithms.js';
import { gridGeom, setupHiDPI, drawEnv, drawValue } from './render.js';

// ---- DOM ------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const envCanvas = $('envCanvas');
const valCanvas = $('valCanvas');
let envCtx, valCtx, envGeom, valGeom;

// ---- state ----------------------------------------------------------------
let mode = MODES.QOIL;
let learner = new Learner(mode, { bonus: 1.0 });
let running = false;
let stepInterval = 90;           // ms per env step (speed slider)
let lastStepTime = 0;
let prevPos = { ...START }, nextPos = { ...START };
let trail = [{ r: START.r, c: START.c, interv: false }];
const heldKeys = new Set();
let criticView = 'opt';          // qoil: 'opt' or 'task'
let lastFlash = 0;
let intervLatched = false;       // spacebar take/release control mode

// ---- canvas sizing --------------------------------------------------------
function resize() {
  envCtx = setupHiDPI(envCanvas);
  valCtx = setupHiDPI(valCanvas);
  envGeom = gridGeom(envCanvas);
  valGeom = gridGeom(valCanvas);
  render();
}
window.addEventListener('resize', resize);

// ---- helpers --------------------------------------------------------------
function heldAction() {
  for (const k of heldKeys) {
    const a = keyToAction(k);
    if (a !== null) return a;
  }
  return null;
}

function recentBonusCells() {
  const s = new Set();
  if (!learner.info.hasBonus || criticView !== 'opt') return s;
  const buf = learner.buffer;
  const start = Math.max(0, buf.length - 60);
  for (let i = start; i < buf.length; i++) s.add(buf[i].r + ',' + buf[i].c);
  return s;
}

// ---- the learning step ----------------------------------------------------
// forcedAction: if provided, this step is a human intervention with that action.
// Otherwise the policy acts (with a momentary held arrow counting as intervention).
function doStep(forcedAction) {
  const ha = (forcedAction !== undefined) ? forcedAction : heldAction();
  const res = learner.stepOnce(ha);
  prevPos = res.prev;
  nextPos = res.next;
  lastStepTime = performance.now();

  if (res.isInterv) lastFlash = performance.now();

  // trail (current episode)
  trail.push({ r: res.next.r, c: res.next.c, interv: res.isInterv });
  if (trail.length > 200) trail.shift();
  if (res.episodeEnded) {
    trail = [{ r: START.r, c: START.c, interv: false }];
    prevPos = { ...START };
    nextPos = { ...START };
  }
  updateMetrics();
}

// One human-driven step while control is latched (event-driven, not auto-paced).
function latchedStep(a) {
  const { dr, dc } = ACTIONS[a];
  // ignore moves into walls so latched control feels responsive
  if (!isFree(learner.pos.r + dr, learner.pos.c + dc)) return;
  doStep(a);
}

// ---- main animation loop --------------------------------------------------
function loop(now) {
  // while control is latched the policy waits — the human steps it by hand
  if (running && !intervLatched) {
    if (now - lastStepTime >= stepInterval) doStep();
  }
  render(now);
  requestAnimationFrame(loop);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function render(now = performance.now()) {
  if (!envGeom) return;
  // interpolate agent between cells for smooth motion
  let frac = running ? Math.min(1, (now - lastStepTime) / stepInterval) : 1;
  const agentPos = {
    r: lerp(prevPos.r, nextPos.r, frac),
    c: lerp(prevPos.c, nextPos.c, frac),
  };
  const intervActive = intervLatched || (now - lastFlash) < 220 || heldAction() !== null;

  drawEnv(envCtx, envGeom, { trail, agentPos, intervActive });

  const name = (mode === MODES.QOIL) ? criticView : 'opt';
  const heat = learner.valueGrid(name);
  const vrange = learner.valueRange(name);
  const path = learner.greedyPath(name);
  drawValue(valCtx, valGeom, { heat, vrange, path, bonusCells: recentBonusCells() });

  // env panel glow + pill when intervening
  envCanvas.parentElement.classList.toggle('intervening', intervActive);
  const pill = $('intervPill');
  pill.classList.toggle('show', intervActive);
  pill.textContent = intervLatched ? "you're in control" : 'intervening';
}

// ---- metrics --------------------------------------------------------------
function updateMetrics() {
  $('mEpisodes').textContent = learner.episodes;
  $('mSteps').textContent = learner.envSteps.toLocaleString();
  $('mSuccess').textContent = (learner.successRate() * 100).toFixed(0) + '%';
  $('mInterv').textContent = learner.interventions;
  const vr = learner.valueRange(mode === MODES.QOIL ? criticView : 'opt');
  $('mMaxQ').textContent = vr.hi.toFixed(2);
  // over-optimism warning
  $('mMaxQ').parentElement.classList.toggle('warn', vr.hi > 2.2);
}

// ---- controls -------------------------------------------------------------
function setMode(m) {
  mode = m;
  learner = new Learner(mode, { bonus: parseFloat($('bonusSlider').value) });
  trail = [{ r: START.r, c: START.c, interv: false }];
  prevPos = { ...START }; nextPos = { ...START };
  document.querySelectorAll('.algo-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === m));
  // bonus control only meaningful when there is a bonus
  const hasBonus = MODE_INFO[m].hasBonus;
  $('bonusSlider').disabled = !hasBonus;
  $('bonusRow').classList.toggle('disabled', !hasBonus);
  // critic toggle only for decoupled Q-OIL
  $('criticToggle').style.display = (m === MODES.QOIL) ? 'inline-flex' : 'none';
  // value panel subtitle
  updateValueSubtitle();
  updateMetrics();
  render();
}

function updateValueSubtitle() {
  let txt;
  if (mode === MODES.QOIL) {
    txt = criticView === 'opt'
      ? 'Optimistic critic Q_opt — interventions add the +b bonus'
      : 'Task critic Q_task — pure task reward (the bonus is decoupled out)';
  } else if (mode === MODES.QOIL_NODEC) {
    txt = 'Single critic — the +b bonus bootstraps backward (watch it over-inflate)';
  } else {
    txt = 'Single critic — task reward only, no optimism bonus';
  }
  $('valSubtitle').textContent = txt;
}

function setRunning(on) {
  running = on;
  lastStepTime = performance.now();
  $('startBtn').classList.toggle('running', on);
  $('startBtn').querySelector('.label').textContent = on ? 'Pause learning' : 'Start learning';
  $('startBtn').querySelector('.icon').textContent = on ? '❚❚' : '▶';
}

function toggleLatch() {
  intervLatched = !intervLatched;
  // taking control implies the loop is live so releasing hands back to the policy
  if (intervLatched && !running) setRunning(true);
  lastStepTime = performance.now();
  const btn = $('latchBtn');
  if (btn) {
    btn.classList.toggle('active', intervLatched);
    btn.querySelector('.label').textContent =
      intervLatched ? 'Release control (Space)' : 'Take control (Space)';
  }
  render();
}

function reset() {
  intervLatched = false;
  if ($('latchBtn')) {
    $('latchBtn').classList.remove('active');
    $('latchBtn').querySelector('.label').textContent = 'Take control (Space)';
  }
  learner = new Learner(mode, { bonus: parseFloat($('bonusSlider').value) });
  trail = [{ r: START.r, c: START.c, interv: false }];
  prevPos = { ...START }; nextPos = { ...START };
  updateMetrics();
  render();
}

// ---- wire up --------------------------------------------------------------
function init() {
  resize();

  document.querySelectorAll('.algo-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  $('startBtn').addEventListener('click', () => setRunning(!running));
  $('latchBtn').addEventListener('click', toggleLatch);
  $('resetBtn').addEventListener('click', reset);

  $('speedSlider').addEventListener('input', (e) => {
    // slider 1..100 -> 220ms (slow) .. 16ms (fast)
    const v = parseFloat(e.target.value);
    stepInterval = Math.round(230 - v * 2.1);
    $('speedVal').textContent = (1000 / stepInterval).toFixed(0) + ' steps/s';
  });

  $('bonusSlider').addEventListener('input', (e) => {
    const b = parseFloat(e.target.value);
    learner.bonus = b;
    $('bonusVal').textContent = '+' + b.toFixed(2);
  });

  document.querySelectorAll('.critic-opt').forEach((b) => {
    b.addEventListener('click', () => {
      criticView = b.dataset.critic;
      document.querySelectorAll('.critic-opt').forEach((x) =>
        x.classList.toggle('active', x === b));
      updateValueSubtitle();
      render();
    });
  });

  // keyboard interventions
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') { e.preventDefault(); toggleLatch(); return; }
    if (e.key === 'p' || e.key === 'P') { setRunning(!running); return; }
    if (e.key === 'r' || e.key === 'R') { reset(); return; }
    const a = keyToAction(e.key);
    if (a !== null) {
      e.preventDefault();
      if (intervLatched) {
        // latched mode: each arrow press is one deliberate intervention step
        latchedStep(a);
      } else {
        // momentary mode: hold an arrow to intervene while the policy runs
        heldKeys.add(e.key);
        if (!running) setRunning(true);   // auto-start so it feels immediate
      }
    }
  });
  window.addEventListener('keyup', (e) => heldKeys.delete(e.key));
  window.addEventListener('blur', () => { heldKeys.clear(); });

  // defaults
  setMode(MODES.QOIL);
  $('speedSlider').dispatchEvent(new Event('input'));
  $('bonusSlider').dispatchEvent(new Event('input'));
  updateMetrics();
  requestAnimationFrame(loop);
}

init();
