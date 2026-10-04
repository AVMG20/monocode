/** Shared plumbing for the composer mascot's events: sprites, effects, act contract. */

import { mascotPath } from "../../projects/model/projectMascots";
import {
  spriteClipBottom,
  type Coin,
  type Platform,
  type RunnerPose,
} from "../model/composerRunner";
import type { RandomActKind, SignalKick } from "../model/runnerEvents";

export type LiveCoin = Coin & {
  el: HTMLDivElement;
  collectedAt: number | null;
  /** Placed on a path the act already jumps; no hop of its own. */
  ride?: boolean;
  /** Not for the mascot — a companion is going for it. */
  reserved?: boolean;
};

/** Where a companion stood this frame, in track coordinates. */
export type CompanionView = {
  id: string;
  index: number;
  x: number;
  y: number;
  facing: 1 | -1;
};

/** One frame of the stage, in track coordinates: x right, y up from the ledge. */
export type ActView = {
  now: number;
  dt: number;
  /** Track origin in viewport px. */
  left: number;
  top: number;
  width: number;
  pose: RunnerPose;
  platforms: readonly Platform[];
  companions: readonly CompanionView[];
};

/** Nudges a companion off its trail spot; `mix` blends toward x/y. */
export type CompanionTweak = {
  /** Sample the trail at this time instead. */
  at?: number;
  x?: number;
  y?: number;
  mix?: number;
  dy?: number;
  facing?: 1 | -1;
};

/** How the acts on stage want the mascot to move this frame. */
export type Directives = {
  /** Multiplier on run speed; 0 holds it in place. */
  speed: number;
  facing?: 1 | -1;
  /** Show the sprite facing against its run (moonwalk). */
  flip: boolean;
  /** Extra height to clear at a given x. */
  lifts: ((x: number) => number)[];
  platforms: Platform[];
  /** Take over the pose outright. */
  pose?: { x?: number; y?: number; ground?: number };
  /** Added on top of wherever the mascot stands. */
  rise: number;
  scale: number;
  squashY: number;
  tilt: number;
  /** Class on the mascot sprite for the act's look. */
  look?: string;
  /** Regular coins may drop. */
  coins: boolean;
  /** Runs straight through the chevron. */
  invincible: boolean;
  companion?: (id: string, index: number, at: number) => CompanionTweak | null;
};

export function baseDirectives(): Directives {
  return {
    speed: 1,
    flip: false,
    lifts: [],
    platforms: [],
    rise: 0,
    scale: 1,
    squashY: 1,
    tilt: 0,
    coins: true,
    invincible: false,
  };
}

export type ActKind =
  | RandomActKind
  | SignalKick
  | "question"
  | "highFive"
  | "sweat"
  | "breather"
  | "nightSky";

export type Act = {
  kind: ActKind;
  direct?(d: Directives, now: number): void;
  /** Draw this frame; false once finished. */
  draw(view: ActView): boolean;
  dispose(): void;
};

/** What acts may do to the runner beyond directing it. */
export type RunnerApi = {
  stun(): void;
  addCoin(
    x: number,
    height: number,
    options?: { ride?: boolean; reserved?: boolean },
  ): LiveCoin;
  coins(): readonly LiveCoin[];
  /** Point the run this way from here on. */
  turn(facing: 1 | -1): void;
  /** Move the run to this track x. */
  teleport(x: number): void;
};

export type Stage = {
  /** Behind the mascot and companions. */
  back: HTMLElement;
  /** In front of everything. */
  front: HTMLElement;
  /** The whole runner layer, for squeezing. */
  layer: HTMLElement;
  api: RunnerApi;
  random: () => number;
};

type Art = readonly string[];
type Layer = { rows: Art; color: string };

const SHADOW = "drop-shadow(0 1px 0 rgba(0,0,0,0.45))";

export type Sprite = {
  el: HTMLDivElement;
  width: number;
  height: number;
  frame(index: number): void;
  place(
    view: Pick<ActView, "left" | "top">,
    x: number,
    y: number,
    options?: {
      facing?: 1 | -1;
      scale?: number;
      scaleY?: number;
      rotate?: number;
      opacity?: number;
      /** Clip whatever sinks below this height, like the rim does the mascot. */
      ground?: number;
    },
  ): void;
  remove(): void;
};

/**
 * A pixel sprite from 8-column art. Each frame is one or more colored layers;
 * `size` is the rendered width of eight cells.
 */
export function sprite(
  parent: HTMLElement,
  frames: readonly (readonly Layer[])[],
  size: number,
): Sprite {
  const cols = frames[0][0].rows[0].length;
  const rows = frames[0][0].rows.length;
  const cell = size / 8;
  const width = cols * cell;
  const height = rows * cell;
  const el = document.createElement("div");
  el.className = "absolute top-0 left-0";
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.transformOrigin = "50% 100%";
  el.style.filter = SHADOW;
  el.style.transform = "translate3d(-64px, -64px, 0)";
  el.innerHTML = frames
    .map(
      (layers, i) =>
        `<svg viewBox="0 0 ${cols} ${rows}" width="${width}" height="${height}" shape-rendering="crispEdges" aria-hidden="true" style="position:absolute;inset:0;display:${i ? "none" : "block"}">${layers
          .map(
            (layer) =>
              `<path fill="${layer.color}" d="${mascotPath(layer.rows)}"/>`,
          )
          .join("")}</svg>`,
    )
    .join("");
  parent.append(el);
  const svgs = Array.from(el.children) as SVGElement[];
  let shown = 0;
  return {
    el,
    width,
    height,
    frame(index) {
      const next = index % svgs.length;
      if (next === shown) return;
      svgs[shown].style.display = "none";
      svgs[next].style.display = "block";
      shown = next;
    },
    place(view, x, y, options = {}) {
      const {
        facing = 1,
        scale = 1,
        scaleY = 1,
        rotate = 0,
        opacity = 1,
        ground,
      } = options;
      const left = Math.round(view.left + x - width / 2);
      const top = Math.round(view.top - height - y + 1);
      el.style.transform = `translate3d(${left}px, ${top}px, 0) scaleX(${facing}) scale(${scale}, ${scale * scaleY}) rotate(${rotate}deg)`;
      el.style.opacity = String(opacity);
      if (ground != null) {
        el.style.clipPath = `inset(0 0 ${spriteClipBottom(y - ground, height)}px 0)`;
      }
    },
    remove() {
      el.remove();
    },
  };
}

export function art(rows: Art, color: string): Layer[] {
  return [{ rows, color }];
}

/** A plain colored box for drops, sparks, beams. */
export function speck(
  parent: HTMLElement,
  width: number,
  height: number,
  color: string,
  glow = false,
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "absolute top-0 left-0";
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.background = color;
  el.style.boxShadow = glow ? `0 0 4px ${color}` : "0 1px 0 rgba(0,0,0,0.35)";
  el.style.transform = "translate3d(-64px, -64px, 0)";
  parent.append(el);
  return el;
}

/** Tiny pixel caption ("pew", "!") floating above the action. */
export function caption(
  parent: HTMLElement,
  text: string,
  color: string,
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "absolute top-0 left-0 font-mono font-bold whitespace-nowrap";
  el.style.fontSize = "8px";
  // Sized up front so placing it never has to measure the text.
  el.style.width = `${text.length * 5 + 2}px`;
  el.style.height = "8px";
  el.style.textAlign = "center";
  el.style.lineHeight = "8px";
  el.style.color = color;
  el.style.textShadow = "0 1px 0 rgba(0,0,0,0.5)";
  el.style.transform = "translate3d(-64px, -64px, 0)";
  el.textContent = text;
  parent.append(el);
  return el;
}

/** Put a box's bottom center at track (x, y). */
export function placeBox(
  el: HTMLElement,
  view: Pick<ActView, "left" | "top">,
  x: number,
  y: number,
  opacity = 1,
) {
  const width = parseFloat(el.style.width) || 0;
  const height = parseFloat(el.style.height) || 0;
  el.style.transform = `translate3d(${Math.round(view.left + x - width / 2)}px, ${Math.round(view.top - height - y + 1)}px, 0)`;
  el.style.opacity = String(opacity);
}

type Particle = {
  el: HTMLElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  born: number;
  life: number;
};

/** Short-lived bits — dust, sparks, crumbs — flying under their own steam. */
export function particles() {
  const live: Particle[] = [];
  return {
    get count() {
      return live.length;
    },
    add(
      el: HTMLElement,
      now: number,
      p: Omit<Particle, "el" | "born" | "gravity"> & { gravity?: number },
    ) {
      live.push({ el, born: now, gravity: 0, ...p });
    },
    step(view: ActView) {
      const dt = view.dt / 1000;
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        p.vy -= p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const t = (view.now - p.born) / p.life;
        if (t >= 1) {
          p.el.remove();
          live.splice(i, 1);
          continue;
        }
        placeBox(p.el, view, p.x, p.y, 1 - t * t);
      }
    },
    clear() {
      for (const p of live) p.el.remove();
      live.length = 0;
    },
  };
}
