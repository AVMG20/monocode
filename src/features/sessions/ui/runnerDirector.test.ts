// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NO_RUNNER_SIGNALS,
  RANDOM_ACTS,
  type RandomActKind,
  type RunnerSignals,
} from "../model/runnerEvents";
import { createDirector, resetLaps } from "./runnerDirector";
import type { ActView, LiveCoin, Stage } from "./runnerStage";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  resetLaps();
});

type Rig = ReturnType<typeof rig>;

/** A director on a fake ledge, with a mascot pacing back and forth. */
function rig(random: () => number, companions = 0) {
  const back = document.createElement("div");
  const front = document.createElement("div");
  const layer = document.createElement("div");
  document.body.append(layer, back, front);
  const coins: LiveCoin[] = [];
  let along = 50;
  let facing: 1 | -1 = 1;
  const width = 600;
  const stage: Stage = {
    back,
    front,
    layer,
    random,
    api: {
      stun: vi.fn(),
      addCoin: (x, height, options) => {
        const coin = {
          id: coins.length,
          x,
          height,
          el: document.createElement("div"),
          collectedAt: null,
          ...options,
        };
        coins.push(coin);
        return coin;
      },
      coins: () => coins,
      turn: (next) => {
        facing = next;
      },
      teleport: (x) => {
        along = x;
      },
    },
  };
  const director = createDirector(stage);
  let now = 1000;
  const step = (signals: RunnerSignals = NO_RUNNER_SIGNALS, dt = 16) => {
    now += dt;
    const d = director.direct(now);
    let bounced = false;
    along += facing * 160 * d.speed * (dt / 1000);
    if (along > width - 10) {
      along = width - 10;
      facing = -1;
      bounced = true;
    } else if (along < 10) {
      along = 10;
      facing = 1;
      bounced = true;
    }
    if (d.facing) facing = d.facing;
    let y = d.rise;
    for (const lift of d.lifts) y = Math.max(y, lift(along));
    // Grab coins the way the runner does.
    for (const coin of coins) {
      if (
        !coin.reserved &&
        coin.collectedAt == null &&
        Math.abs(coin.x - along) < 10
      ) {
        coin.collectedAt = now;
      }
    }
    const view: ActView = {
      now,
      dt,
      left: 0,
      top: 300,
      width,
      pose: { x: d.pose?.x ?? along, y: d.pose?.y ?? y, facing, airborne: y > 0.5 },
      platforms: d.platforms,
      companions: Array.from({ length: companions }, (_, i) => ({
        id: `c${i}`,
        index: i,
        x: along - facing * (14 + i * 14),
        y: 0,
        facing,
      })),
    };
    if (d.companion) {
      for (const c of view.companions) d.companion(c.id, c.index, now - 240);
    }
    director.frame(view, { signals, working: true, bounced });
    return d;
  };
  return { director, stage, step, back, front, layer, coins, get now() { return now; } };
}

/** Always pick `kind`: index into the eligible pool by its position. */
function pickerFor(kind: RandomActKind, companions: number) {
  const pool = (Object.keys(RANDOM_ACTS) as RandomActKind[]).filter((k) => {
    const rule = RANDOM_ACTS[k];
    if (rule.crew && companions < 1) return false;
    return !rule.night;
  });
  const weight = (k: RandomActKind) =>
    RANDOM_ACTS[k].weight * (RANDOM_ACTS[k].crew ? 1.6 : 1);
  const total = pool.reduce((sum, k) => sum + weight(k), 0);
  let before = 0;
  for (const k of pool) {
    if (k === kind) break;
    before += weight(k);
  }
  return (before + weight(kind) / 2) / total;
}

function runUntilQuiet(r: Rig, frames = 3000) {
  for (let i = 0; i < frames; i++) r.step();
}

describe("createDirector", () => {
  const kinds = (Object.keys(RANDOM_ACTS) as RandomActKind[]).filter(
    (kind) => !RANDOM_ACTS[kind].night,
  );

  it.each(kinds)("plays %s to the end and cleans up", (kind) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12));
    const companions = RANDOM_ACTS[kind].crew ? 2 : 0;
    const pick = pickerFor(kind, companions);
    // First call is the bounce target (3); afterwards always our act.
    let calls = 0;
    const r = rig(() => (calls++ === 0 ? 0 : pick), companions);
    const added = () => r.back.childElementCount + r.front.childElementCount;
    let shown = false;
    for (let i = 0; i < 4000; i++) {
      r.step();
      shown ||= added() > 0;
    }
    // These move the cast around without drawing anything of their own.
    if (!["moonwalk", "wave", "totem"].includes(kind)) {
      expect(shown).toBe(true);
    }
    r.director.clear();
    expect(added()).toBe(0);
    expect(r.layer.style.transform).toBe("");
  });

  it("answers a failing tool with a goomba and an edit with a brick", () => {
    const r = rig(() => 0.5);
    r.step();
    r.step({ ...NO_RUNNER_SIGNALS, failures: 1, edits: 1 });
    expect(r.back.childElementCount).toBeGreaterThanOrEqual(2);
    runUntilQuiet(r);
    expect(r.back.childElementCount).toBe(0);
  });

  it("holds still under a ? block while waiting, then lets go", () => {
    const r = rig(() => 0.5);
    r.step();
    const waiting = { ...NO_RUNNER_SIGNALS, waiting: true };
    r.step(waiting);
    expect(r.step(waiting).speed).toBe(0);
    for (let i = 0; i < 100; i++) r.step(waiting);
    expect(r.step(waiting).speed).toBe(0);
    for (let i = 0; i < 100; i++) r.step();
    expect(r.step().speed).toBe(1);
  });

  it("squeezes the layer on compaction and restores it", () => {
    const r = rig(() => 0.5);
    r.step();
    r.step({ ...NO_RUNNER_SIGNALS, compactions: 1 });
    r.step({ ...NO_RUNNER_SIGNALS, compactions: 1 }, 200);
    expect(r.layer.style.transform).toContain("scale(");
    for (let i = 0; i < 100; i++) r.step({ ...NO_RUNNER_SIGNALS, compactions: 1 });
    expect(r.layer.style.transform).toBe("");
  });

  it("keeps counting laps across turns", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12));
    const r = rig(() => 0);
    const view: ActView = {
      now: 0,
      dt: 16,
      left: 0,
      top: 300,
      width: 600,
      pose: { x: 300, y: 0, facing: 1, airborne: false },
      platforms: [],
      companions: [],
    };
    const lap = (director = r.director, now = 0) =>
      director.frame(
        { ...view, now },
        { signals: NO_RUNNER_SIGNALS, working: true, bounced: true },
      );
    lap();
    lap();
    r.director.clear();
    expect(r.back.childElementCount).toBe(0);
    // A new turn picks up on the third lap instead of starting over.
    lap(createDirector(r.stage), 16);
    expect(r.back.childElementCount).toBeGreaterThan(0);
  });

  it("does not replay signals that were already there when it started", () => {
    const r = rig(() => 0.5);
    r.step({ ...NO_RUNNER_SIGNALS, failures: 3 });
    expect(r.back.childElementCount).toBe(0);
  });
});
