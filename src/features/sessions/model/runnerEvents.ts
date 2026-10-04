/**
 * Little events that break up the composer mascot's patrol: some answer what
 * the session is doing (a tool failing, an approval waiting, a file written),
 * the rest are rolled now and then for fun.
 */

import { isEditTool } from "../../../integrations/harness/core/preview";
import type { Block } from "./session";

/** Running tallies for the turn in flight; the runner reacts when one grows. */
export type RunnerSignals = {
  failures: number;
  denials: number;
  edits: number;
  fetches: number;
  compactions: number;
  /** An approval or question is waiting on the user. */
  waiting: boolean;
};

export const NO_RUNNER_SIGNALS: RunnerSignals = {
  failures: 0,
  denials: 0,
  edits: 0,
  fetches: 0,
  compactions: 0,
  waiting: false,
};

function isWebTool(block: Block): boolean {
  const kind = block.tool?.kind?.trim().toLowerCase() ?? "";
  if (kind === "fetch" || kind.includes("web")) return true;
  const title = `${block.text} ${block.tool?.title ?? ""}`.trim();
  // Claude files WebSearch under "search" next to grep; its label names it.
  if (kind === "search") return /^web\s*search\b/i.test(title);
  if (kind && kind !== "other") return false;
  return /^(web\s*(fetch|search)|fetch)\b|^https?:\/\//i.test(title);
}

/** Tally the current turn: everything since the last user turn that started one. */
export function runnerSignals(
  blocks: readonly Block[],
  pendingQuestion = false,
): RunnerSignals {
  const signals = { ...NO_RUNNER_SIGNALS, waiting: pendingQuestion };
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "user") {
      if (block.draft || block.steered) continue;
      break;
    }
    const denied = block.approval?.decided === "deny";
    if (denied) signals.denials += 1;
    else if (block.approval && !block.approval.decided) signals.waiting = true;
    if (
      block.role === "system" &&
      /^compact(ed|ing) (the )?context/i.test(block.text.trim())
    ) {
      signals.compactions += 1;
    }
    if (block.role !== "tool" || !block.tool) continue;
    const status = block.tool.status?.toLowerCase() ?? "";
    if ((status === "failed" || status === "error") && !denied) {
      signals.failures += 1;
    }
    if (isWebTool(block)) signals.fetches += 1;
    if (
      (status === "completed" || status === "success") &&
      isEditTool(block.tool.kind, block.text || block.tool.title, block.tool.preview)
    ) {
      signals.edits += 1;
    }
  }
  return signals;
}

export type SignalKick =
  | "goomba"
  | "spiky"
  | "brick"
  | "bird"
  | "squish";

/** What grew since the last look, one kick per new occurrence (capped). */
export function signalKicks(
  prev: RunnerSignals,
  next: RunnerSignals,
): SignalKick[] {
  const kicks: SignalKick[] = [];
  const grow = (kick: SignalKick, from: number, to: number, cap = 2) => {
    for (let i = 0; i < Math.min(cap, to - from); i++) kicks.push(kick);
  };
  grow("spiky", prev.denials, next.denials, 1);
  grow("goomba", prev.failures, next.failures);
  grow("brick", prev.edits, next.edits, 3);
  grow("bird", prev.fetches, next.fetches, 1);
  grow("squish", prev.compactions, next.compactions, 1);
  return kicks;
}

/** Sweat starts after this long working; breathers come later. */
export const SWEAT_AFTER_MS = 2 * 60_000;
export const BREATHER_AFTER_MS = 5 * 60_000;
export const BREATHER_GAP_MIN_MS = 60_000;
export const BREATHER_GAP_MAX_MS = 90_000;

/** Wall bounces between random events. */
export const BOUNCES_MIN = 3;
export const BOUNCES_MAX = 10;

export function nextBounceTarget(random = Math.random): number {
  return BOUNCES_MIN + Math.floor(random() * (BOUNCES_MAX - BOUNCES_MIN + 1));
}

export function isNight(date: Date): boolean {
  const hour = date.getHours();
  return hour >= 22 || hour < 6;
}

export type RandomActKind =
  | "zombies"
  | "coinStreak"
  | "mushroom"
  | "starPower"
  | "pipeWarp"
  | "boo"
  | "windGust"
  | "sneeze"
  | "dance"
  | "butterfly"
  | "bananaPeel"
  | "rainCloud"
  | "moonwalk"
  | "yawn"
  | "companionTrip"
  | "wave"
  | "totem"
  | "groupPhoto"
  | "coinSteal";

type ActRule = {
  weight: number;
  /** Narrowest track the act still reads on. */
  minWidth?: number;
  /** Needs subagents tagging along. */
  crew?: boolean;
  night?: boolean;
};

export const RANDOM_ACTS: Record<RandomActKind, ActRule> = {
  zombies: { weight: 3, minWidth: 200 },
  coinStreak: { weight: 3, minWidth: 220 },
  mushroom: { weight: 2, minWidth: 160 },
  starPower: { weight: 1.5, minWidth: 160 },
  pipeWarp: { weight: 2, minWidth: 160 },
  boo: { weight: 2, minWidth: 160 },
  windGust: { weight: 2, minWidth: 180 },
  sneeze: { weight: 3 },
  dance: { weight: 3 },
  butterfly: { weight: 2, minWidth: 160 },
  bananaPeel: { weight: 2.5, minWidth: 160 },
  rainCloud: { weight: 2 },
  moonwalk: { weight: 2.5 },
  yawn: { weight: 3, night: true },
  companionTrip: { weight: 3, crew: true },
  wave: { weight: 3, crew: true },
  totem: { weight: 2.5, crew: true },
  groupPhoto: { weight: 2, crew: true, minWidth: 160 },
  coinSteal: { weight: 2.5, crew: true, minWidth: 180 },
};

/** Recent picks sit out so the same gag doesn't repeat back to back. */
export const RECENT_ACTS = 4;

export type ActRoll = {
  width: number;
  companions: number;
  night: boolean;
  recent: readonly RandomActKind[];
};

export function eligibleActs(roll: ActRoll): RandomActKind[] {
  return (Object.keys(RANDOM_ACTS) as RandomActKind[]).filter((kind) => {
    const rule = RANDOM_ACTS[kind];
    if (roll.recent.includes(kind)) return false;
    if (rule.crew && roll.companions < 1) return false;
    if (rule.night && !roll.night) return false;
    return roll.width >= (rule.minWidth ?? 0);
  });
}

export function pickRandomAct(
  roll: ActRoll,
  random = Math.random,
): RandomActKind | null {
  const pool = eligibleActs(roll);
  // With a crew along, favor the gags only they can do.
  const weight = (kind: RandomActKind) =>
    RANDOM_ACTS[kind].weight * (RANDOM_ACTS[kind].crew ? 1.6 : 1);
  const total = pool.reduce((sum, kind) => sum + weight(kind), 0);
  if (total <= 0) return null;
  let pick = random() * total;
  for (const kind of pool) {
    pick -= weight(kind);
    if (pick < 0) return kind;
  }
  return pool[pool.length - 1];
}

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 2;
export const easeInOut = (t: number) => {
  const u = clamp01(t);
  return u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
};
/** A hop over `t` in 0..1: 0 at both ends, `height` at the middle. */
export const hop = (t: number, height: number) => {
  const u = clamp01(t);
  return 4 * u * (1 - u) * height;
};

/** Mario's grow flicker: small and big swapping faster until big sticks. */
export const GROW_STEPS = [1, 1.25, 1, 1.25, 1, 1.25, 1.5, 1.25, 1.5];
export const GROW_STEP_MS = 70;

export function growScale(elapsedMs: number, big: number): number {
  const i = Math.floor(elapsedMs / GROW_STEP_MS);
  if (i < 0) return 1;
  if (i >= GROW_STEPS.length) return big;
  return 1 + (GROW_STEPS[i] - 1) * ((big - 1) / 0.5);
}

/** The same flicker backwards, for shrinking back down. */
export function shrinkScale(elapsedMs: number, big: number): number {
  return growScale(GROW_STEPS.length * GROW_STEP_MS - 1 - elapsedMs, big);
}

/** Compaction squeeze: shrink toward the middle, then spring back past full. */
export const SQUISH_MS = 1100;

export function squishScale(elapsedMs: number): number {
  const t = elapsedMs / SQUISH_MS;
  if (t <= 0 || t >= 1) return 1;
  if (t < 0.35) return 1 - 0.38 * easeOut(t / 0.35);
  if (t < 0.5) return 0.62;
  const u = (t - 0.5) / 0.5;
  // Damped overshoot back to 1.
  return 1 - 0.38 * Math.cos(u * Math.PI * 1.5) * (1 - u);
}

export const SPRITES = {
  zombie: [
    [
      "..###...",
      "..#.##..",
      "..####..",
      "..######",
      "..###...",
      "..###...",
      "..#.#...",
      ".##.##..",
    ],
    [
      "..###...",
      "..#.##..",
      "..####..",
      "..######",
      "..###...",
      "..###...",
      "..#..#..",
      ".##...#.",
    ],
  ],
  goomba: [
    [
      "..####..",
      ".######.",
      "##.##.##",
      "########",
      ".######.",
      "..#..#..",
      ".##..##.",
      "........",
    ],
    [
      "..####..",
      ".######.",
      "##.##.##",
      "########",
      ".######.",
      "..#..#..",
      "..##.##.",
      "........",
    ],
  ],
  spiky: [
    [
      "#.#..#.#",
      ".######.",
      "##.##.##",
      "########",
      ".######.",
      "..#..#..",
      ".##..##.",
      "........",
    ],
    [
      "#.#..#.#",
      ".######.",
      "##.##.##",
      "########",
      ".######.",
      "..#..#..",
      "..##.##.",
      "........",
    ],
  ],
  block: [
    "########",
    "########",
    "########",
    "########",
    "########",
    "########",
    "########",
    "########",
  ],
  question: [
    "........",
    "..###...",
    ".#...#..",
    ".....#..",
    "....#...",
    "...#....",
    "........",
    "...#....",
  ],
  blockRivets: [
    "#......#",
    "........",
    "........",
    "........",
    "........",
    "........",
    "........",
    "#......#",
  ],
  brick: [
    "####.###",
    "####.###",
    "........",
    "#.######",
    "#.######",
    "........",
    "####.###",
    "####.###",
  ],
  bird: [
    [
      "........",
      ".##.....",
      "..##....",
      "..###.##",
      ".######.",
      "..####..",
      "........",
      "........",
    ],
    [
      "........",
      "........",
      "......##",
      ".#######",
      "..####..",
      "..##....",
      ".##.....",
      "........",
    ],
  ],
  envelope: [
    "........",
    "########",
    "##....##",
    "#.#..#.#",
    "#..##..#",
    "#......#",
    "########",
    "........",
  ],
  mushroomCap: [
    "..####..",
    ".######.",
    "########",
    "########",
    "........",
    "........",
    "........",
    "........",
  ],
  mushroomSpots: [
    "........",
    "..#..#..",
    ".#....#.",
    "........",
    "........",
    "........",
    "........",
    "........",
  ],
  mushroomStem: [
    "........",
    "........",
    "........",
    "........",
    ".#.##.#.",
    ".######.",
    "..####..",
    "..####..",
  ],
  boo: [
    [
      "..####..",
      ".######.",
      "#.##.###",
      "########",
      "##....##",
      "########",
      "#######.",
      "#.#.#...",
    ],
    // Shy: eyes covered, mouth shut.
    [
      "..####..",
      ".######.",
      "########",
      "#..#..##",
      "########",
      "###..###",
      "#######.",
      "#.#.#...",
    ],
  ],
  butterfly: [
    [
      "........",
      "##....##",
      "###..###",
      ".######.",
      "..####..",
      ".##..##.",
      "##....##",
      "........",
    ],
    [
      "........",
      "...##...",
      "..####..",
      "...##...",
      "...##...",
      "..####..",
      "...##...",
      "........",
    ],
  ],
  cloud: [
    "........",
    "..###...",
    ".#####..",
    ".######.",
    "########",
    "########",
    ".######.",
    "........",
  ],
  banana: [
    "........",
    "........",
    "........",
    "...##...",
    "..#..#..",
    ".#....#.",
    "#......#",
    "........",
  ],
  note: [
    "....##..",
    "....#.#.",
    "....#..#",
    "....#...",
    "....#...",
    ".####...",
    "#####...",
    ".###....",
  ],
  heart: [
    "........",
    ".##.##..",
    "#######.",
    "#######.",
    ".#####..",
    "..###...",
    "...#....",
    "........",
  ],
  zee: [
    "........",
    ".#####..",
    "....#...",
    "...#....",
    "..#.....",
    ".#####..",
    "........",
    "........",
  ],
  coin: [
    "........",
    "..####..",
    ".######.",
    "########",
    "########",
    ".######.",
    "..####..",
    "........",
  ],
  star: [
    "...##...",
    "...##...",
    "..####..",
    "########",
    "########",
    "..####..",
    ".##..##.",
    "##....##",
  ],
} as const;
