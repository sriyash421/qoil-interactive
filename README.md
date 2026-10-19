# Q-OIL — Interactive Intervention Learning

A self-contained website that trains three intervention-learning algorithms
**live in the browser** while *you* provide the interventions with the keyboard.
Nothing is pre-computed except the maze layout — every Q-value, policy and
optimism bonus is learned online from scratch (tabular Q-learning).

## Run

It's pure static HTML/JS (ES modules), so it needs to be served over HTTP
(opening `index.html` via `file://` will be blocked by the module loader):

```bash
cd interactive_website
python3 -m http.server 8000
# then open http://localhost:8000
```

## How to use

- **Algorithm buttons** (HIL / Q-OIL no-decoupling / Q-OIL): pick which method
  trains. Switching starts that method fresh.
- **Start learning**: runs the online training loop; the value heatmap reshapes
  in real time.
- **Two ways to intervene** (both flagged violet, stored in the replay buffer,
  and — in the Q-OIL variants — carrying the optimism bonus `+b`):
  - *Momentary*: while training runs, **hold an arrow key / WASD** to nudge the
    agent for that step.
  - *Latched*: hit **Space** (or "Take control") to fully take over — the policy
    pauses and the agent moves only on your arrow presses — then **Space** again
    to hand control back to the controller.
- **Speed / Optimism bonus** sliders, **Reset**. Keyboard: `Space`
  (take/release control), `P` (play/pause), `R` (reset).

## Panels

- **Environment & policy rollouts** — the maze, the agent, and the live
  trajectory: policy steps in blue, your interventions in violet.
- **Value function Q(s)** — heatmap of the critic, plus the **optimal trajectory
  greedy under that Q**. For Q-OIL you can toggle the **optimistic** critic
  (`Q_opt`, with `+b`) vs the **task** critic (`Q_task`); `+b` markers show where
  your interventions injected optimism.

## The three methods (only difference = bonus handling)

| Method | optimism bonus | critics |
|---|---|---|
| **HIL** | none | single critic, task reward only |
| **Q-OIL (no decoupling)** | `+b` on interventions | single critic — bonus leaks backward → over-optimism (watch `max Q` blow up) |
| **Q-OIL** | `+b` on interventions | **decoupled**: optimistic critic bootstraps from the task critic, confining the bonus to intervention states |

## Files

- `js/maze.js` — the only baked-in data: the real 9×12 PointMaze layout.
- `js/algorithms.js` — the three live tabular learners.
- `js/render.js` — canvas drawing + value colorscale (matches the paper figures).
- `js/app.js` — control loop, keyboard interventions, metrics.
