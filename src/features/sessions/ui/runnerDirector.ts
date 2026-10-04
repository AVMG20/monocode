/**
 * Decides what happens on the composer ledge: reacts to the session's signals,
 * and every few wall bounces rolls a random event.
 */

import {
  BREATHER_AFTER_MS,
  BREATHER_GAP_MAX_MS,
  BREATHER_GAP_MIN_MS,
  RECENT_ACTS,
  SWEAT_AFTER_MS,
  isNight,
  nextBounceTarget,
  pickRandomAct,
  signalKicks,
  type RandomActKind,
  type RunnerSignals,
} from "../model/runnerEvents";
import {
  bananaPeelAct,
  birdAct,
  booAct,
  breatherAct,
  bricksAct,
  butterflyAct,
  coinStreakAct,
  danceAct,
  goombaAct,
  highFiveAct,
  moonwalkAct,
  nightSkyAct,
  pipeWarpAct,
  powerUpAct,
  questionAct,
  rainCloudAct,
  sneezeAct,
  squishAct,
  sweatAct,
  windGustAct,
  yawnAct,
  zombiesAct,
  type BrickAct,
} from "./runnerActs";
import {
  coinStealAct,
  companionTripAct,
  groupPhotoAct,
  totemAct,
  waveAct,
} from "./runnerCrewActs";
import {
  baseDirectives,
  type Act,
  type ActView,
  type Directives,
  type Stage,
} from "./runnerStage";

type Cue = (view: ActView) => Act;

const RANDOM: Record<RandomActKind, (stage: Stage, view: ActView) => Act> = {
  zombies: zombiesAct,
  coinStreak: coinStreakAct,
  mushroom: (stage, view) => powerUpAct(stage, view, "mushroom"),
  starPower: (stage, view) => powerUpAct(stage, view, "starPower"),
  pipeWarp: pipeWarpAct,
  boo: booAct,
  windGust: windGustAct,
  sneeze: sneezeAct,
  dance: danceAct,
  butterfly: butterflyAct,
  bananaPeel: bananaPeelAct,
  rainCloud: rainCloudAct,
  moonwalk: moonwalkAct,
  yawn: yawnAct,
  companionTrip: companionTripAct,
  wave: waveAct,
  totem: totemAct,
  groupPhoto: groupPhotoAct,
  coinSteal: coinStealAct,
};

/**
 * Laps toward the next random event. Shared and kept across turns, so short
 * turns add up instead of each starting the count over.
 */
const laps = { count: 0, target: 0 };

/** Signal events waiting their turn; more than this and the rest are dropped. */
const MAX_CUES = 3;

export type FrameInput = {
  signals: RunnerSignals;
  /** The agent itself is at work, not just watching background commands. */
  working: boolean;
  /** The mascot turned around at a wall this frame. */
  bounced: boolean;
};

export type Director = {
  /** How the acts on stage want the mascot to move, before it moves. */
  direct(now: number): Directives;
  /** React to what changed, then draw every act. */
  frame(view: ActView, input: FrameInput): void;
  /** A subagent reported back; `clone` is its sprite for the high five. */
  companionLeft(
    clone: HTMLElement,
    from: { x: number; y: number; facing: 1 | -1 },
  ): void;
  /** Turn over: drop everything and start fresh next time. */
  clear(): void;
};

/** Start the lap count over; for tests. */
export function resetLaps() {
  laps.count = 0;
  laps.target = 0;
}

export function createDirector(stage: Stage): Director {
  let main: Act | null = null;
  let ambient: Act[] = [];
  let bricks: BrickAct | null = null;
  let cues: Cue[] = [];
  let seen: RunnerSignals | null = null;
  let startedAt: number | null = null;
  if (laps.target === 0) laps.target = nextBounceTarget(stage.random);
  let recent: RandomActKind[] = [];
  let sweating = false;
  let nextBreather = 0;
  let night = false;
  let nightCheckAt = 0;

  const cue = (next: Cue, first = false) => {
    if (cues.length >= MAX_CUES) return;
    if (first) cues.unshift(next);
    else cues.push(next);
  };

  const hasAmbient = (kind: Act["kind"]) => ambient.some((a) => a.kind === kind);

  const react = (view: ActView, signals: RunnerSignals) => {
    if (seen) {
      for (const kick of signalKicks(seen, signals)) {
        if (kick === "goomba" || kick === "spiky") {
          cue((v) => goombaAct(stage, v, kick === "spiky"));
        } else if (kick === "bird") {
          cue((v) => birdAct(stage, v));
        } else if (kick === "brick") {
          if (!bricks) {
            bricks = bricksAct(stage);
            ambient.push(bricks);
          }
          bricks.drop(view);
        } else if (kick === "squish" && !hasAmbient("squish")) {
          ambient.push(squishAct(stage, view));
        }
      }
    }
    seen = signals;
    // An approval or question outranks whatever else is going on.
    if (signals.waiting && main?.kind !== "question") {
      main?.dispose();
      main = questionAct(stage, view, () => seen?.waiting ?? false);
    }
  };

  const pace = (view: ActView, input: FrameInput) => {
    startedAt ??= view.now;
    const age = view.now - startedAt;
    if (!sweating && age >= SWEAT_AFTER_MS) {
      sweating = true;
      ambient.push(sweatAct(stage, view));
    }
    if (age >= BREATHER_AFTER_MS && view.now >= nextBreather) {
      nextBreather =
        view.now +
        BREATHER_GAP_MIN_MS +
        stage.random() * (BREATHER_GAP_MAX_MS - BREATHER_GAP_MIN_MS);
      if (input.working) cue((v) => breatherAct(stage, v));
    }
    if (!night && view.now >= nightCheckAt) {
      nightCheckAt = view.now + 60_000;
      if (!isNight(new Date())) return;
      night = true;
      ambient.push(nightSkyAct(stage, view));
    }
  };

  const roll = (view: ActView, input: FrameInput) => {
    if (!input.bounced || !input.working || main || cues.length) return;
    laps.count += 1;
    if (laps.count < laps.target) return;
    laps.count = 0;
    laps.target = nextBounceTarget(stage.random);
    const kind = pickRandomAct(
      {
        width: view.width,
        companions: view.companions.length,
        night,
        recent,
      },
      stage.random,
    );
    if (!kind) return;
    recent = [kind, ...recent].slice(0, RECENT_ACTS);
    main = RANDOM[kind](stage, view);
  };

  return {
    direct(now) {
      const d = baseDirectives();
      for (const act of ambient) act.direct?.(d, now);
      main?.direct?.(d, now);
      return d;
    },
    frame(view, input) {
      react(view, input.signals);
      pace(view, input);
      roll(view, input);
      if (!main && cues.length) main = cues.shift()!(view);

      ambient = ambient.filter((act) => {
        if (act.draw(view)) return true;
        act.dispose();
        if (act === bricks) bricks = null;
        return false;
      });
      if (main && !main.draw(view)) {
        main.dispose();
        main = null;
      }
    },
    companionLeft(clone, from) {
      cue((v) => highFiveAct(stage, v, clone, from), true);
    },
    clear() {
      main?.dispose();
      main = null;
      for (const act of ambient) act.dispose();
      ambient = [];
      bricks = null;
      cues = [];
      seen = null;
      startedAt = null;
      sweating = false;
      nextBreather = 0;
      night = false;
      nightCheckAt = 0;
    },
  };
}
