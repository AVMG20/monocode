/** Events that need subagents tagging along behind the mascot. */

import {
  COIN_HOVER,
  COMPANION_SIZE,
  RUNNER_INSET,
  RUNNER_SIZE,
  platformHeight,
} from "../model/composerRunner";
import {
  SPRITES,
  clamp01,
  easeInOut,
  easeOut,
  hop,
} from "../model/runnerEvents";
import { clampX, toward } from "./runnerActs";
import {
  art,
  caption,
  placeBox,
  sprite,
  type Act,
  type ActView,
  type CompanionTweak,
  type Stage,
} from "./runnerStage";

/** A companion trips, sees stars, then hurries to catch back up. */
export function companionTripAct(stage: Stage, view: ActView): Act {
  const STUN = 600;
  const CATCH = 750;
  const victim =
    view.companions[Math.floor(stage.random() * view.companions.length)];
  const born = view.now;
  const stars = [0, 1, 2].map(() =>
    sprite(stage.front, [art(SPRITES.star, "#f4e27a")], 6),
  );
  // How far behind its usual spot it is replaying the mascot's run.
  const lag = (now: number) => {
    const age = now - born;
    if (age < STUN) return age;
    return STUN * (1 - easeInOut((age - STUN) / CATCH));
  };
  return {
    kind: "companionTrip",
    direct(d, now) {
      d.companion = (id, _index, at) =>
        id === victim.id
          ? { at: at - lag(now), dy: hop((now - born) / 220, 5) }
          : null;
    },
    draw(v) {
      const age = v.now - born;
      const me = v.companions.find((c) => c.id === victim.id);
      if (!me) return false;
      const fade = age < STUN - 120 ? 1 : clamp01((STUN - age) / 120);
      stars.forEach((s, i) => {
        const a = age / 110 + (i * Math.PI * 2) / 3;
        s.place(v, me.x + Math.cos(a) * 8, me.y + COMPANION_SIZE + Math.sin(a) * 3, {
          opacity: fade,
        });
      });
      return age < STUN + CATCH;
    },
    dispose() {
      for (const s of stars) s.remove();
    },
  };
}

/** A stadium wave down the line and back. */
export function waveAct(_stage: Stage, view: ActView): Act {
  const STEP = 110;
  const HOP = 300;
  const HEIGHT = 10;
  const born = view.now;
  const ids = view.companions.map((c) => c.id);
  const n = ids.length;
  const back = (n + 1) * STEP + 250;
  const end = back + n * STEP + HOP;
  const bounce = (age: number, start: number) =>
    age >= start && age <= start + HOP ? hop((age - start) / HOP, HEIGHT) : 0;
  return {
    kind: "wave",
    direct(d, now) {
      const age = now - born;
      d.rise = bounce(age, 0) + bounce(age, back + n * STEP);
      d.companion = (id) => {
        const i = ids.indexOf(id);
        if (i < 0) return null;
        return {
          dy: bounce(age, (i + 1) * STEP) + bounce(age, back + (n - 1 - i) * STEP),
        };
      };
    },
    draw: (v) => v.now - born < end,
    dispose() {},
  };
}

/** The crew hops up into a wobbly totem on the mascot's head, then hops off. */
export function totemAct(_stage: Stage, view: ActView): Act {
  const UP = 380;
  const GAP = 260;
  const RIDE = 1800;
  const born = view.now;
  const ids = view.companions.slice(0, 4).map((c) => c.id);
  const n = ids.length;
  const full = 200 + n * GAP + UP;
  const downStart = (i: number) => full + RIDE + (n - 1 - i) * 200;
  const end = downStart(0) + UP;
  let pose = view.pose;
  const progress = (i: number, age: number) => {
    const up = 200 + i * GAP;
    if (age < up) return { p: 0, moving: false };
    if (age < up + UP) return { p: easeInOut((age - up) / UP), moving: true, t: (age - up) / UP };
    const down = downStart(i);
    if (age < down) return { p: 1, moving: false };
    return { p: 1 - easeInOut((age - down) / UP), moving: age < down + UP, t: (age - down) / UP };
  };
  return {
    kind: "totem",
    direct(d, now) {
      const age = now - born;
      d.coins = false;
      d.speed = age > full && age < downStart(n - 1) ? 0.3 : 0;
      d.companion = (id): CompanionTweak | null => {
        const i = ids.indexOf(id);
        if (i < 0) return null;
        const { p, moving, t } = progress(i, age);
        if (p <= 0) return null;
        return {
          x: pose.x + Math.sin(now / 180 + i) * 0.6 * (i + 1),
          y: pose.y + RUNNER_SIZE - 2 + i * (COMPANION_SIZE - 2),
          mix: p,
          dy: moving ? hop(t ?? 0, 12) : 0,
          facing: pose.facing,
        };
      };
    },
    draw(v) {
      pose = v.pose;
      return v.now - born < end;
    },
    dispose() {},
  };
}

/** Everyone lines up, hops for the camera — flash — and back to work. */
export function groupPhotoAct(stage: Stage, view: ActView): Act {
  const LINE = 350;
  const HOP_AT = 600;
  const FLASH_AT = 750;
  const RELEASE = 1500;
  const END = 1850;
  const born = view.now;
  const ids = view.companions.map((c) => c.id);
  const f = view.pose.facing;
  const reach = 12 + ids.length * 14;
  const behind = view.pose.x - f * reach >= RUNNER_INSET + 6;
  const dir = behind ? -f : f;
  let pose = view.pose;
  let platforms = view.platforms;
  const flash = document.createElement("div");
  flash.className = "absolute top-0 left-0 rounded-full";
  flash.style.width = `${reach + 40}px`;
  flash.style.height = "44px";
  flash.style.background =
    "radial-gradient(closest-side, rgba(255,255,255,0.95), rgba(255,255,255,0))";
  flash.style.opacity = "0";
  stage.front.append(flash);
  const cheese = caption(stage.front, "cheese!", "#ffd23f");
  cheese.style.opacity = "0";

  const slot = (i: number) =>
    clampX(view, pose.x + dir * (12 + i * 14), 6);
  return {
    kind: "groupPhoto",
    direct(d, now) {
      const age = now - born;
      d.coins = false;
      if (age < RELEASE) d.speed = 0;
      d.rise = hop((age - HOP_AT) / 300, 8);
      const mix =
        age < LINE
          ? easeOut(age / LINE)
          : age < RELEASE
            ? 1
            : 1 - easeInOut((age - RELEASE) / (END - RELEASE));
      d.companion = (id) => {
        const i = ids.indexOf(id);
        if (i < 0) return null;
        const x = slot(i);
        return {
          x,
          y: platformHeight(x, platforms),
          mix,
          dy: hop((age - HOP_AT - (i + 1) * 30) / 300, 8),
          facing: f,
        };
      };
    },
    draw(v) {
      pose = v.pose;
      platforms = v.platforms;
      const age = v.now - born;
      const mid = pose.x + dir * (reach / 2);
      const glow =
        age < FLASH_AT ? 0 : age < FLASH_AT + 40 ? (age - FLASH_AT) / 40 : 1 - clamp01((age - FLASH_AT - 40) / 200);
      placeBox(flash, v, mid, -6, 0.85 * glow);
      const say = clamp01((age - 450) / 650);
      placeBox(cheese, v, mid, 30 + 6 * say, age > 450 ? 1 - say * say : 0);
      return age < END;
    },
    dispose() {
      flash.remove();
      cheese.remove();
    },
  };
}

/** A companion breaks ranks to snag a coin first; the mascot is not amused. */
export function coinStealAct(stage: Stage, view: ActView): Act {
  const thief = view.companions[0];
  const born = view.now;
  const coin = stage.api.addCoin(
    clampX(view, view.pose.x - view.pose.facing * 60, 40),
    COIN_HOVER - 8,
    { ride: true, reserved: true },
  );
  const JUMP = 380;
  const RETURN = 450;
  let x = thief.x;
  let phase: "run" | "jump" | "back" = "run";
  let phaseAt = born;
  let tookAt: number | null = null;
  let thiefFacing: 1 | -1 = toward(thief.x, coin.x);
  let runX = view.pose.x;
  let platforms = view.platforms;
  const huff = caption(stage.front, "!", "#ff6b6b");
  huff.style.opacity = "0";

  return {
    kind: "coinSteal",
    direct(d, now) {
      d.coins = false;
      if (tookAt != null && now - tookAt < 1000) {
        const age = now - tookAt;
        d.speed = 0;
        d.facing = toward(runX, x);
        d.squashY = 1 - 0.08 * Math.abs(Math.sin(age / 60));
      }
      const since = now - phaseAt;
      d.companion = (id) => {
        if (id !== thief.id) return null;
        const ground = platformHeight(x, platforms);
        if (phase === "run") return { x, y: ground, mix: 1, facing: thiefFacing };
        if (phase === "jump") {
          const reach = coin.height - COMPANION_SIZE / 2 - 2;
          return { x, y: ground, mix: 1, dy: hop(since / JUMP, reach), facing: thiefFacing };
        }
        return { x, y: ground, mix: 1 - easeInOut(since / RETURN), facing: thiefFacing };
      };
    },
    draw(v) {
      const { now, pose } = v;
      runX = pose.x;
      platforms = v.platforms;
      const since = now - phaseAt;
      if (!v.companions.some((c) => c.id === thief.id)) {
        coin.collectedAt ??= now;
        return false;
      }
      if (phase === "run") {
        thiefFacing = toward(x, coin.x);
        const step = 200 * (v.dt / 1000);
        x += Math.max(-step, Math.min(step, coin.x - x));
        if (Math.abs(coin.x - x) < 1) {
          phase = "jump";
          phaseAt = now;
        } else if (now - born > 6000) {
          coin.collectedAt ??= now;
          phase = "back";
          phaseAt = now;
        }
      } else if (phase === "jump") {
        if (since >= JUMP / 2 && tookAt == null) {
          tookAt = now;
          coin.collectedAt = now;
        }
        if (since >= JUMP) {
          phase = "back";
          phaseAt = now;
        }
      }
      const angry = tookAt != null ? now - tookAt : -1;
      placeBox(
        huff,
        v,
        pose.x,
        pose.y + RUNNER_SIZE + 4 + Math.min(4, angry / 40),
        angry >= 0 && angry < 900 ? 1 : 0,
      );
      return phase !== "back" || since < RETURN || (angry >= 0 && angry < 1000);
    },
    dispose() {
      coin.collectedAt ??= performance.now();
      huff.remove();
    },
  };
}
