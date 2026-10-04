import { describe, expect, it } from "vitest";
import {
  BOUNCES_MAX,
  BOUNCES_MIN,
  GROW_STEPS,
  GROW_STEP_MS,
  NO_RUNNER_SIGNALS,
  RANDOM_ACTS,
  SQUISH_MS,
  eligibleActs,
  growScale,
  isNight,
  nextBounceTarget,
  pickRandomAct,
  runnerSignals,
  shrinkScale,
  signalKicks,
  squishScale,
} from "./runnerEvents";
import type { Block } from "./session";

const tool = (id: string, tool: Block["tool"], extra: Partial<Block> = {}) =>
  ({ id, role: "tool", text: "", tool, ...extra }) as Block;

describe("runnerSignals", () => {
  it("tallies only the turn in flight", () => {
    const blocks: Block[] = [
      tool("old", { kind: "edit", status: "failed" }),
      { id: "u1", role: "user", text: "go" },
      tool("e1", { kind: "edit", status: "completed" }),
      tool("e2", { kind: "edit", status: "in_progress" }),
      tool("f1", { kind: "execute", status: "failed" }),
      tool("w1", { kind: "fetch", status: "completed" }),
      tool("a1", { kind: "execute" }, { approval: { requestId: 1, decided: "deny" } }),
      { id: "s1", role: "system", text: "Compacted context" },
      { id: "u2", role: "user", text: "also", steered: true },
      tool("w2", { kind: "search", title: "Web search: pixel art", status: "completed" }),
      tool("g1", { kind: "search", title: "Search apps/web", status: "completed" }),
      tool("e3", { kind: "edit", title: "Edit apps/web/index.ts", status: "completed" }),
      tool("d1", { kind: "execute", status: "failed" }, { approval: { requestId: 2, decided: "deny" } }),
      { id: "s2", role: "system", text: "Could not compact this context" },
    ];
    expect(runnerSignals(blocks)).toEqual({
      failures: 1,
      denials: 2,
      edits: 2,
      fetches: 2,
      compactions: 1,
      waiting: false,
    });
  });

  it("is waiting on an open approval or question", () => {
    const blocks: Block[] = [
      { id: "u", role: "user", text: "go" },
      tool("t", { kind: "execute" }, { approval: { requestId: 1 } }),
    ];
    expect(runnerSignals(blocks).waiting).toBe(true);
    expect(runnerSignals(blocks.slice(0, 1), true).waiting).toBe(true);
    expect(runnerSignals(blocks.slice(0, 1)).waiting).toBe(false);
  });
});

describe("signalKicks", () => {
  it("kicks once per new occurrence, capped", () => {
    const next = {
      ...NO_RUNNER_SIGNALS,
      failures: 5,
      denials: 2,
      edits: 9,
      fetches: 1,
      compactions: 1,
    };
    const kicks = signalKicks(NO_RUNNER_SIGNALS, next);
    expect(kicks.filter((k) => k === "goomba")).toHaveLength(2);
    expect(kicks.filter((k) => k === "spiky")).toHaveLength(1);
    expect(kicks.filter((k) => k === "brick")).toHaveLength(3);
    expect(kicks).toContain("bird");
    expect(kicks).toContain("squish");
    expect(signalKicks(next, next)).toEqual([]);
  });
});

describe("random acts", () => {
  it("waits 3 to 10 bounces", () => {
    expect(nextBounceTarget(() => 0)).toBe(BOUNCES_MIN);
    expect(nextBounceTarget(() => 0.9999)).toBe(BOUNCES_MAX);
  });

  it("keeps crew gags for when subagents are along", () => {
    const solo = eligibleActs({ width: 600, companions: 0, night: false, recent: [] });
    const crew = eligibleActs({ width: 600, companions: 2, night: false, recent: [] });
    expect(solo.some((kind) => RANDOM_ACTS[kind].crew)).toBe(false);
    expect(crew).toContain("totem");
    expect(crew).toContain("wave");
  });

  it("skips recent picks, night-only and too-wide acts", () => {
    const pool = eligibleActs({
      width: 170,
      companions: 0,
      night: false,
      recent: ["sneeze"],
    });
    expect(pool).not.toContain("sneeze");
    expect(pool).not.toContain("yawn");
    expect(pool).not.toContain("zombies");
    expect(pool).toContain("dance");
    expect(
      eligibleActs({ width: 600, companions: 0, night: true, recent: [] }),
    ).toContain("yawn");
  });

  it("picks across the whole pool", () => {
    const roll = { width: 600, companions: 1, night: true, recent: [] };
    const pool = eligibleActs(roll);
    expect(pickRandomAct(roll, () => 0)).toBe(pool[0]);
    expect(pickRandomAct(roll, () => 0.99999)).toBe(pool[pool.length - 1]);
    expect(pickRandomAct({ ...roll, recent: pool })).toBeNull();
  });

  it("knows night", () => {
    expect(isNight(new Date(2026, 0, 1, 23))).toBe(true);
    expect(isNight(new Date(2026, 0, 1, 3))).toBe(true);
    expect(isNight(new Date(2026, 0, 1, 14))).toBe(false);
  });
});

describe("motion", () => {
  it("grows with a flicker and shrinks back", () => {
    const total = GROW_STEPS.length * GROW_STEP_MS;
    expect(growScale(0, 1.5)).toBe(1);
    expect(growScale(total, 1.5)).toBe(1.5);
    expect(shrinkScale(0, 1.5)).toBe(1.5);
    expect(shrinkScale(total, 1.5)).toBe(1);
  });

  it("squeezes and springs back to full size", () => {
    expect(squishScale(0)).toBe(1);
    expect(squishScale(SQUISH_MS * 0.4)).toBeCloseTo(0.62);
    expect(squishScale(SQUISH_MS)).toBe(1);
    const overshoot = Math.max(
      ...Array.from({ length: 50 }, (_, i) => squishScale((SQUISH_MS * i) / 50)),
    );
    expect(overshoot).toBeGreaterThan(1);
  });
});
