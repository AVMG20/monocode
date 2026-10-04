/** The mascot's solo events, and the ones the session's own work sets off. */

import {
  COIN_HOVER,
  COIN_JUMP_LEAD,
  COMPANION_SIZE,
  RUNNER_INSET,
  RUNNER_SIZE,
  arc,
  exitJumpY,
  platformHeight,
} from "../model/composerRunner";
import {
  SPRITES,
  SQUISH_MS,
  clamp01,
  easeInOut,
  easeOut,
  growScale,
  hop,
  shrinkScale,
  squishScale,
} from "../model/runnerEvents";
import {
  art,
  caption,
  particles,
  placeBox,
  speck,
  sprite,
  type Act,
  type ActView,
  type Sprite,
  type Stage,
} from "./runnerStage";

const GOLD = "#e8b923";
const SPARKS = ["#ffd23f", "#ff6fae", "#7cc4ff", "#8be38b", "#ffffff"];

export function clampX(view: ActView, x: number, pad = 8): number {
  return Math.min(
    view.width - RUNNER_INSET - pad,
    Math.max(RUNNER_INSET + pad, x),
  );
}

export const toward = (from: number, to: number): 1 | -1 =>
  to >= from ? 1 : -1;

const groundAt = (view: ActView, x: number) =>
  platformHeight(x, view.platforms);

function pick<T>(stage: Stage, items: readonly T[]): T {
  return items[Math.floor(stage.random() * items.length) % items.length];
}

/** A caption that drifts up and fades. */
function floater(
  stage: Stage,
  text: string,
  color: string,
  now: number,
  x: number,
  y: number,
  life = 420,
) {
  const el = caption(stage.front, text, color);
  return {
    draw(view: ActView): boolean {
      const t = (view.now - now) / life;
      if (t >= 1) {
        el.remove();
        return false;
      }
      placeBox(el, view, x, y + 10 * easeOut(t), 1 - t * t);
      return true;
    },
    remove: () => el.remove(),
  };
}

type Floater = ReturnType<typeof floater>;

function drawAll(view: ActView, items: Floater[]) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (!items[i].draw(view)) items.splice(i, 1);
  }
}

// ── Signals ────────────────────────────────────────────────────────────────

/**
 * A tool failed: a goomba walks in and the mascot stomps it. A denied
 * approval sends a spiky one instead, which the mascot runs into.
 */
export function goombaAct(stage: Stage, view: ActView, spiky: boolean): Act {
  const color = spiky ? "#c2453d" : "#a0663a";
  const body = sprite(
    stage.back,
    SPRITES[spiky ? "spiky" : "goomba"].map((rows) => art(rows, color)),
    12,
  );
  const born = view.now;
  let dir: 1 | -1 = view.pose.facing === 1 ? -1 : 1;
  let x = dir === -1 ? view.width - RUNNER_INSET - 6 : RUNNER_INSET + 6;
  let phase: "walk" | "squash" | "gloat" | "leave" = "walk";
  let phaseAt = born;
  let runX = view.pose.x;
  let runFacing = view.pose.facing;
  let bounceFrom: number | null = null;
  let bounceFacing: 1 | -1 = 1;

  const go = (next: typeof phase, now: number) => {
    phase = next;
    phaseAt = now;
  };

  return {
    kind: spiky ? "spiky" : "goomba",
    direct(d) {
      d.coins = false;
      // Keep the arc until it has landed past the goomba, stomp or not.
      if (phase === "walk" && !spiky && (x + runFacing * 8 - runX) * runFacing > 0) {
        // Leave early enough that the way down lands on its head.
        const from = x - runFacing * 40;
        const to = x + runFacing * 8;
        d.lifts.push((px) =>
          arc(px, Math.min(from, to), Math.max(from, to), 26, 0),
        );
      }
      if (bounceFrom != null) {
        const from = bounceFrom - bounceFacing * 10;
        const to = bounceFrom + bounceFacing * 40;
        d.lifts.push((px) =>
          arc(px, Math.min(from, to), Math.max(from, to), 22, 0),
        );
      }
    },
    draw(v) {
      const { now, pose } = v;
      runX = pose.x;
      runFacing = pose.facing;
      const dt = v.dt / 1000;
      const since = now - phaseAt;
      if (bounceFrom != null && Math.abs(pose.x - bounceFrom) > 44) {
        bounceFrom = null;
      }

      if (phase === "walk") {
        x += dir * 30 * dt;
        if (x <= RUNNER_INSET + 6 || x >= v.width - RUNNER_INSET - 6) {
          x = clampX(v, x, 6);
          dir = dir === 1 ? -1 : 1;
        }
        const dx = Math.abs(pose.x - x);
        if (!spiky && dx < 5 && pose.y > 5 && pose.y < 18) {
          bounceFrom = pose.x;
          bounceFacing = pose.facing;
          go("squash", now);
        } else if (spiky && dx < 11 && pose.y < 6) {
          stage.api.stun();
          go("gloat", now);
        } else if (now - born > 14000) {
          go("leave", now);
        }
      } else if (phase === "gloat" && since > 700) {
        dir = x < v.width / 2 ? -1 : 1;
        go("leave", now);
      } else if (phase === "leave") {
        x += dir * 40 * dt;
      }

      const enter = clamp01((now - born) / 350);
      const y = groundAt(v, x) - 12 * (1 - easeOut(enter));
      body.frame(Math.floor(now / 220));
      if (phase === "squash") {
        if (since > 550) return false;
        body.place(v, x, groundAt(v, x), {
          facing: dir,
          scaleY: 0.35,
          opacity: since < 300 ? 1 : 1 - (since - 300) / 250,
        });
        return true;
      }
      if (phase === "leave") {
        const fade = since / 600;
        if (fade >= 1) return false;
        body.place(v, x, y, { facing: dir, opacity: 1 - fade });
        return true;
      }
      const gloat = phase === "gloat" ? hop((since % 233) / 233, 4) : 0;
      body.place(v, x, y + gloat, { facing: dir, ground: groundAt(v, x) });
      return true;
    },
    dispose: () => body.remove(),
  };
}

/** Waiting on an approval: sit tight under a ? block, then bonk a coin out. */
export function questionAct(
  stage: Stage,
  view: ActView,
  waiting: () => boolean,
): Act {
  const BLOCK_Y = 34;
  const block = sprite(
    stage.front,
    [
      [
        { rows: SPRITES.block, color: "#d99a1e" },
        { rows: SPRITES.blockRivets, color: "#8a5a1a" },
        { rows: SPRITES.question, color: "#fff4c2" },
      ],
      [
        { rows: SPRITES.block, color: "#8a5a2b" },
        { rows: SPRITES.blockRivets, color: "#5e3b1a" },
      ],
    ],
    12,
  );
  const coin = sprite(stage.front, [art(SPRITES.coin, GOLD)], 10);
  coin.el.style.opacity = "0";
  const born = view.now;
  const facing = view.pose.facing;
  let x = view.pose.x;
  let base = view.pose.y;
  let bonkAt: number | null = null;

  return {
    kind: "question",
    direct(d, now) {
      d.speed = 0;
      d.coins = false;
      if (bonkAt == null) {
        const age = now - born;
        d.look = "runner-still";
        // Glance around, tap a foot.
        d.facing = Math.floor(age / 1400) % 2 ? (facing === 1 ? -1 : 1) : facing;
        d.squashY = age % 520 < 90 ? 0.92 : 1;
        return;
      }
      d.facing = facing;
      d.pose = { y: base + hop((now - bonkAt) / 320, 18) };
    },
    draw(v) {
      const { now } = v;
      if (bonkAt == null) {
        x = v.pose.x;
        base = v.pose.y;
        if (!waiting()) bonkAt = now;
      }
      const pop = clamp01((now - born) / 180);
      const bob = Math.sin(now / 220) * 1.5;
      if (bonkAt == null) {
        block.place(v, x, base + BLOCK_Y + bob, { scale: easeOut(pop) });
        return true;
      }
      const since = now - bonkAt;
      const hit = since >= 160;
      if (hit) block.frame(1);
      const bump = hit ? hop((since - 160) / 160, 4) : 0;
      const fade = clamp01((since - 700) / 250);
      block.place(v, x, base + BLOCK_Y + bump, { opacity: 1 - fade });
      if (hit) {
        const t = (since - 160) / 450;
        coin.place(v, x, base + BLOCK_Y + 12 + 20 * easeOut(t), {
          scaleY: 1,
          scale: 1,
          opacity: t >= 1 ? 0 : 1 - clamp01((t - 0.6) / 0.4),
        });
        coin.el.style.transform += ` scaleX(${Math.cos(t * Math.PI * 4)})`;
      }
      return since < 950;
    },
    dispose() {
      block.remove();
      coin.remove();
    },
  };
}

export type BrickAct = Act & { drop(view: ActView): void };

/** Files written: bricks drop onto the ledge to hop over, then crumble. */
export function bricksAct(stage: Stage): BrickAct {
  const COLOR = "#b5562f";
  type Brick = {
    sprite: Sprite;
    x: number;
    y: number;
    vy: number;
    landedAt: number | null;
    side: number;
    passes: number;
  };
  const bricks: Brick[] = [];
  const bits = particles();

  const crumble = (brick: Brick, now: number) => {
    brick.sprite.remove();
    bricks.splice(bricks.indexOf(brick), 1);
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      bits.add(speck(stage.back, 4, 4, COLOR), now, {
        x: brick.x + side * 3,
        y: brick.y + (i < 2 ? 8 : 2),
        vx: side * (30 + stage.random() * 40),
        vy: 60 + stage.random() * 60,
        gravity: 420,
        life: 650,
      });
    }
  };

  return {
    kind: "brick",
    drop(view) {
      if (bricks.length >= 3) crumble(bricks[0], view.now);
      const { pose } = view;
      for (let i = 0; i < 12; i++) {
        // Behind the mascot first, so nothing lands on its head.
        const x =
          i < 6
            ? pose.x - pose.facing * (40 + stage.random() * 90)
            : RUNNER_INSET + 14 + stage.random() * (view.width - RUNNER_INSET * 2 - 28);
        if (x < RUNNER_INSET + 12 || x > view.width - RUNNER_INSET - 12) continue;
        if (Math.abs(x - pose.x) < 36) continue;
        if (groundAt(view, x) > 0 || groundAt(view, x - 8) > 0 || groundAt(view, x + 8) > 0) continue;
        if (bricks.some((brick) => Math.abs(brick.x - x) < 18)) continue;
        bricks.push({
          sprite: sprite(stage.back, [art(SPRITES.brick, COLOR)], 12),
          x,
          y: 64,
          vy: 0,
          landedAt: null,
          side: Math.sign(pose.x - x),
          passes: 0,
        });
        return;
      }
    },
    direct(d) {
      for (const brick of bricks) {
        if (brick.landedAt == null) continue;
        d.platforms.push({ left: brick.x - 6, right: brick.x + 6, height: 12 });
      }
    },
    draw(v) {
      const dt = v.dt / 1000;
      for (const brick of [...bricks]) {
        if (brick.landedAt == null) {
          brick.vy -= 900 * dt;
          brick.y = Math.max(0, brick.y + brick.vy * dt);
          if (brick.y === 0) brick.landedAt = v.now;
        }
        const side = Math.sign(v.pose.x - brick.x);
        if (side && brick.side && side !== brick.side) brick.passes += 1;
        if (side) brick.side = side;
        if (
          brick.landedAt != null &&
          (brick.passes >= 2 || v.now - brick.landedAt > 12000)
        ) {
          crumble(brick, v.now);
          continue;
        }
        const thud =
          brick.landedAt != null && v.now - brick.landedAt < 90 ? 0.8 : 1;
        brick.sprite.place(v, brick.x, brick.y, { scaleY: thud });
      }
      bits.step(v);
      return bricks.length > 0 || bits.count > 0;
    },
    dispose() {
      for (const brick of bricks) brick.sprite.remove();
      bricks.length = 0;
      bits.clear();
    },
  };
}

/** Context compacted: everything on the ledge gets squeezed, then springs back. */
export function squishAct(stage: Stage, view: ActView): Act {
  const born = view.now;
  const reset = () => {
    stage.layer.style.transform = "";
    stage.layer.style.transformOrigin = "";
  };
  return {
    kind: "squish",
    draw(v) {
      const age = v.now - born;
      if (age >= SQUISH_MS) {
        reset();
        return false;
      }
      stage.layer.style.transformOrigin = `${v.left + v.width / 2}px ${v.top}px`;
      stage.layer.style.transform = `scale(${squishScale(age)})`;
      return true;
    },
    dispose: reset,
  };
}

/** A long turn: sweat drops, and a slightly hurried pace. */
export function sweatAct(stage: Stage, view: ActView): Act {
  const drops: { el: HTMLElement; at: number; side: 1 | -1 }[] = [];
  let nextAt = view.now;
  return {
    kind: "sweat",
    direct(d) {
      d.speed *= 1.12;
    },
    draw(v) {
      const { now, pose } = v;
      if (now >= nextAt) {
        nextAt = now + 3200;
        drops.push({
          el: speck(stage.front, 2, 3, "#7cc4ff"),
          at: now,
          side: pose.facing === 1 ? -1 : 1,
        });
      }
      for (const drop of [...drops]) {
        const t = (now - drop.at) / 700;
        if (t >= 1) {
          drop.el.remove();
          drops.splice(drops.indexOf(drop), 1);
          continue;
        }
        placeBox(drop.el, v, pose.x + drop.side * 6, pose.y + 13 - 6 * t, 1 - t);
      }
      return true;
    },
    dispose() {
      for (const drop of drops) drop.el.remove();
    },
  };
}

/** A very long turn: stop for a breather, "…", then on again. */
export function breatherAct(stage: Stage, view: ActView): Act {
  const born = view.now;
  const dots = [0, 1, 2].map(() => speck(stage.front, 2, 2, "#c9ced6"));
  return {
    kind: "breather",
    direct(d, now) {
      const age = now - born;
      d.coins = false;
      d.speed = age < 300 ? 1 - age / 300 : age > 2100 ? (age - 2100) / 300 : 0;
      d.squashY = 1 + 0.04 * Math.sin(age / 170);
      if (age > 300 && age < 2100) d.look = "runner-still";
    },
    draw(v) {
      const age = v.now - born;
      dots.forEach((dot, i) => {
        const shown = age > 400 + i * 300 && age < 2100;
        placeBox(dot, v, v.pose.x - 4 + i * 4, v.pose.y + 19, shown ? 1 : 0);
      });
      return age < 2400;
    },
    dispose() {
      for (const dot of dots) dot.remove();
    },
  };
}

/** A subagent reported back: it runs up for a high five before hopping off. */
export function highFiveAct(
  stage: Stage,
  view: ActView,
  clone: HTMLElement,
  from: { x: number; y: number; facing: 1 | -1 },
): Act {
  stage.back.append(clone);
  const spark = sprite(stage.front, [art(SPRITES.star, "#ffd23f")], 9);
  spark.el.style.opacity = "0";
  const bits = particles();
  let x = from.x;
  let y = from.y;
  let phase: "run" | "slap" | "leave" = "run";
  let phaseAt = view.now;
  let side: 1 | -1 = toward(view.pose.x, from.x);
  let sparked = false;

  const placeClone = (v: ActView, cx: number, cy: number, facing: 1 | -1, clip = 0) => {
    clone.style.setProperty("--runner-x", `${Math.round(v.left + cx - COMPANION_SIZE / 2)}px`);
    clone.style.setProperty("--runner-y", `${Math.round(v.top - COMPANION_SIZE - cy + 1)}px`);
    clone.style.setProperty("--runner-facing", String(facing));
    clone.style.setProperty("--runner-clip", `${clip}px`);
  };

  return {
    kind: "highFive",
    direct(d, now) {
      d.speed = 0;
      d.coins = false;
      d.facing = side;
      if (phase === "slap") d.rise = hop((now - phaseAt) / 360, 12);
    },
    draw(v) {
      const { now, pose } = v;
      const since = now - phaseAt;
      const facing = toward(x, pose.x);
      if (phase === "run") {
        side = toward(pose.x, x);
        const target = pose.x + side * 14;
        const step = 150 * (v.dt / 1000);
        x += Math.max(-step, Math.min(step, target - x));
        y += (groundAt(v, x) - y) * Math.min(1, v.dt / 90);
        placeClone(v, x, y, facing);
        if (Math.abs(target - x) < 1 || since > 1500) {
          phase = "slap";
          phaseAt = now;
        }
        return true;
      }
      if (phase === "slap") {
        const t = since / 360;
        placeClone(v, x, y + hop(t, 12), facing);
        if (t >= 0.5 && !sparked) {
          sparked = true;
          for (let i = 0; i < 4; i++) {
            bits.add(speck(stage.front, 2, 2, pick(stage, SPARKS)), now, {
              x: (x + pose.x) / 2,
              y: pose.y + 24,
              vx: (i % 2 ? 1 : -1) * (30 + stage.random() * 30),
              vy: 20 + stage.random() * 40,
              life: 380,
            });
          }
        }
        if (sparked) {
          const s = clamp01((since - 180) / 260);
          spark.place(v, (x + pose.x) / 2, pose.y + 22, {
            scale: hop(s, 1.3),
            opacity: 1 - s * s,
          });
        }
        if (t >= 1) {
          phase = "leave";
          phaseAt = now;
        }
      } else {
        const t = since / 450;
        if (t >= 1 && bits.count === 0) return false;
        const cy = y + exitJumpY(clamp01(t), 10, COMPANION_SIZE);
        placeClone(v, x, cy, facing, Math.min(COMPANION_SIZE, Math.ceil(Math.max(0, y - cy))));
        spark.el.style.opacity = "0";
      }
      bits.step(v);
      return true;
    },
    dispose() {
      clone.remove();
      spark.remove();
      bits.clear();
    },
  };
}

/** A web call went out: a bird drops off a letter. */
export function birdAct(stage: Stage, view: ActView): Act {
  const bird = sprite(
    stage.front,
    SPRITES.bird.map((rows) => art(rows, "#5b8bd6")),
    11,
  );
  const letter = sprite(stage.front, [art(SPRITES.envelope, "#f4f1ea")], 9);
  letter.el.style.opacity = "0";
  const dir: 1 | -1 = view.pose.facing === 1 ? -1 : 1;
  let bx = dir === -1 ? view.width + 6 : -6;
  let letterState: "held" | "falling" | "caught" | "done" = "held";
  let lx = 0;
  let ly = 0;
  let vy = 0;
  let caughtAt = 0;

  return {
    kind: "bird",
    direct(d, now) {
      if (letterState === "falling") {
        d.speed = 0;
        d.coins = false;
      }
      if (letterState === "caught") {
        d.speed = 0;
        d.rise = hop((now - caughtAt) / 280, 8);
      }
    },
    draw(v) {
      const { now, pose } = v;
      const dt = v.dt / 1000;
      bx += dir * 110 * dt;
      const by = 56 + Math.sin(now / 160) * 2;
      bird.frame(Math.floor(now / 130));
      bird.place(v, bx, by, { facing: dir });
      if (letterState === "held" && Math.abs(bx - pose.x) < 6) {
        letterState = "falling";
        lx = bx;
        ly = by - 4;
      }
      if (letterState === "falling") {
        vy -= 260 * dt;
        ly += vy * dt;
        lx += (pose.x - lx) * Math.min(1, dt * 6);
        letter.place(v, lx, ly, { rotate: Math.sin(now / 90) * 10 });
        if (ly <= pose.y + RUNNER_SIZE) {
          letterState = "caught";
          caughtAt = now;
        }
      } else if (letterState === "caught") {
        const t = (now - caughtAt) / 280;
        letter.place(v, pose.x, pose.y + RUNNER_SIZE + 6 * t, { opacity: 1 - t });
        if (t >= 1) letterState = "done";
      }
      const gone = bx < -16 || bx > v.width + 16;
      return !(gone && (letterState === "done" || letterState === "held"));
    },
    dispose() {
      bird.remove();
      letter.remove();
    },
  };
}

// ── Random ─────────────────────────────────────────────────────────────────

/** Three shamblers rise from the rim; the mascot stands its ground. Pew pew. */
export function zombiesAct(stage: Stage, view: ActView): Act {
  const side: 1 | -1 = view.pose.x < view.width / 2 ? 1 : -1;
  const edge = side === 1 ? view.width - RUNNER_INSET - 8 : RUNNER_INSET + 8;
  const born = view.now;
  type Zombie = {
    sprite: Sprite;
    x: number;
    rise: number;
    hp: number;
    incoming: number;
    flashUntil: number;
    diedAt: number | null;
  };
  const zombies: Zombie[] = [0, 1, 2].map((i) => ({
    sprite: sprite(stage.back, SPRITES.zombie.map((rows) => art(rows, "#7fb069")), 13),
    x: edge - side * i * 22,
    rise: born + i * 280,
    hp: 2,
    incoming: 0,
    flashUntil: 0,
    diedAt: null,
  }));
  type Bolt = { el: HTMLElement; x: number; y: number; target: Zombie };
  const bolts: Bolt[] = [];
  const pews: Floater[] = [];
  const bits = particles();
  let nextShot = born + 900;
  let shots = 0;
  let recoilUntil = 0;
  let wonAt: number | null = null;

  return {
    kind: "zombies",
    direct(d, now) {
      d.speed = 0;
      d.coins = false;
      d.facing = side;
      if (now < recoilUntil) d.squashY = 0.9;
      if (wonAt != null) d.rise = hop((now - wonAt) / 360, 12);
    },
    draw(v) {
      const { now, pose } = v;
      const dt = v.dt / 1000;
      const standing = (z: Zombie) => z.diedAt == null && now - z.rise > 420;

      if (wonAt == null && now >= nextShot) {
        const target = zombies
          .filter((z) => standing(z) && z.hp - z.incoming > 0)
          .sort((a, b) => Math.abs(a.x - pose.x) - Math.abs(b.x - pose.x))[0];
        if (target) {
          target.incoming += 1;
          shots += 1;
          bolts.push({
            el: speck(stage.front, 7, 2, "#ff4d6d", true),
            x: pose.x + side * 9,
            y: pose.y + 8,
            target,
          });
          pews.push(
            floater(stage, shots % 2 ? "pew" : "pew!", "#ff8fa3", now, pose.x + side * 4, pose.y + 18, 380),
          );
          recoilUntil = now + 60;
          nextShot = now + 280;
        }
      }

      for (const bolt of [...bolts]) {
        bolt.x += side * 380 * dt;
        const z = bolt.target;
        const reached = (bolt.x - z.x) * side >= -4;
        const lost = bolt.x < 0 || bolt.x > v.width;
        if (reached && z.diedAt == null) {
          z.hp -= 1;
          z.flashUntil = now + 90;
          z.x += side * 3;
          if (z.hp <= 0) z.diedAt = now;
          for (let i = 0; i < 3; i++) {
            bits.add(speck(stage.front, 2, 2, "#ffd1dc"), now, {
              x: bolt.x,
              y: bolt.y,
              vx: -side * (20 + stage.random() * 40),
              vy: -20 + stage.random() * 60,
              life: 260,
            });
          }
        }
        if (reached || lost) {
          z.incoming = Math.max(0, z.incoming - 1);
          bolt.el.remove();
          bolts.splice(bolts.indexOf(bolt), 1);
          continue;
        }
        placeBox(bolt.el, v, bolt.x, bolt.y);
      }

      let left = 0;
      for (const z of zombies) {
        const ground = groundAt(v, z.x);
        if (z.diedAt != null) {
          const t = (now - z.diedAt) / 520;
          if (t >= 1) {
            z.sprite.el.style.opacity = "0";
            continue;
          }
          left += 1;
          const fall = easeOut(t / 0.45);
          const sink = clamp01((t - 0.45) / 0.55) * 14;
          z.sprite.place(v, z.x, ground - sink, {
            facing: -side as 1 | -1,
            rotate: -90 * fall,
            ground,
          });
          continue;
        }
        left += 1;
        const up = clamp01((now - z.rise) / 420);
        if (up > 0 && now > born + 600 && Math.abs(z.x - pose.x) > 16) {
          z.x -= side * 12 * dt;
        }
        z.sprite.frame(Math.floor(now / 320));
        z.sprite.el.style.filter =
          now < z.flashUntil ? "brightness(2.6)" : "drop-shadow(0 1px 0 rgba(0,0,0,0.45))";
        z.sprite.place(v, z.x, ground - 14 * (1 - easeOut(up)), {
          facing: -side as 1 | -1,
          rotate: Math.sin(now / 200 + z.x) * 5,
          ground,
          opacity: now < z.rise ? 0 : 1,
        });
      }
      if (left === 0 && wonAt == null) wonAt = now;
      if (wonAt == null && now - born > 14000) {
        for (const z of zombies) z.diedAt ??= now;
      }

      drawAll(v, pews);
      bits.step(v);
      return wonAt == null || now - wonAt < 380 || pews.length > 0;
    },
    dispose() {
      for (const z of zombies) z.sprite.remove();
      for (const bolt of bolts) bolt.el.remove();
      for (const pew of pews) pew.remove();
      bits.clear();
    },
  };
}

/** A rainbow of coins, taken in one long jump. */
export function coinStreakAct(stage: Stage, view: ActView): Act {
  const COUNT = 5;
  const GAP = 16;
  const PEAK = 46;
  const span = (COUNT - 1) * GAP;
  const pad = COIN_JUMP_LEAD + span / 2 + 4;
  const center = clampX(view, view.pose.x + view.pose.facing * 120, pad);
  const left = center - span / 2;
  const right = center + span / 2;
  const lift = (x: number) => arc(x, left, right, PEAK, COIN_JUMP_LEAD);
  const coins = Array.from({ length: COUNT }, (_, i) => {
    const x = left + i * GAP;
    return stage.api.addCoin(x, lift(x) + RUNNER_SIZE / 2, { ride: true });
  });
  const born = view.now;
  const live = () => coins.some((coin) => coin.collectedAt == null);
  let runX = view.pose.x;
  return {
    kind: "coinStreak",
    direct(d) {
      d.coins = false;
      // Finish the jump after the last coin rather than dropping out of it.
      if (live() || lift(runX) > 0.5) d.lifts.push(lift);
    },
    draw(v) {
      runX = v.pose.x;
      if (v.now - born > 16000) {
        for (const coin of coins) coin.collectedAt ??= v.now;
      }
      return live() || lift(v.pose.x) > 0.5;
    },
    dispose() {
      for (const coin of coins) coin.collectedAt ??= performance.now();
    },
  };
}

/** A power-up slides out of the rim; catching it grows the mascot or makes it a star. */
export function powerUpAct(
  stage: Stage,
  view: ActView,
  kind: "mushroom" | "starPower",
): Act {
  const star = kind === "starPower";
  const item = sprite(
    stage.back,
    star
      ? [art(SPRITES.star, "#ffd23f")]
      : [
          [
            { rows: SPRITES.mushroomCap, color: "#d94a3a" },
            { rows: SPRITES.mushroomSpots, color: "#ffffff" },
            { rows: SPRITES.mushroomStem, color: "#f3e3c3" },
          ],
        ],
    star ? 11 : 12,
  );
  const BIG = 1.5;
  const POWER_MS = star ? 6000 : 8000;
  const growMs = 9 * 70;
  const born = view.now;
  let x = view.pose.x < view.width / 2
    ? view.width - RUNNER_INSET - 30
    : RUNNER_INSET + 30;
  let dir: 1 | -1 = toward(view.pose.x, x);
  let y = 0;
  let caughtAt: number | null = null;
  let leaveAt: number | null = null;
  let sparkAt = 0;
  const bits = particles();

  return {
    kind,
    direct(d, now) {
      if (caughtAt == null) return;
      const age = now - caughtAt;
      if (age >= POWER_MS) return;
      d.coins = !star;
      if (star) {
        d.speed *= 1.8;
        d.invincible = true;
        d.look = age > POWER_MS - 1000 ? "runner-starman runner-starman-ending" : "runner-starman";
        return;
      }
      d.scale =
        age < growMs
          ? growScale(age, BIG)
          : age > POWER_MS - growMs
            ? shrinkScale(age - (POWER_MS - growMs), BIG)
            : BIG;
    },
    draw(v) {
      const { now, pose } = v;
      if (caughtAt != null) {
        const age = now - caughtAt;
        if (star && age < POWER_MS && now >= sparkAt) {
          sparkAt = now + 80;
          bits.add(speck(stage.back, 2, 2, pick(stage, SPARKS)), now, {
            x: pose.x - pose.facing * 6,
            y: pose.y + 4 + stage.random() * 8,
            vx: -pose.facing * 20,
            vy: 10 + stage.random() * 20,
            life: 380,
          });
        }
        bits.step(v);
        return age < POWER_MS || bits.count > 0;
      }
      if (leaveAt != null) {
        const t = (now - leaveAt) / 400;
        item.place(v, x, y - 12 * t, { ground: groundAt(v, x) });
        return t < 1;
      }
      const emerge = clamp01((now - born) / 420);
      if (emerge >= 1) {
        x += dir * (star ? 90 : 70) * (v.dt / 1000);
        if (x <= RUNNER_INSET + 6 || x >= v.width - RUNNER_INSET - 6) {
          x = clampX(v, x, 6);
          dir = dir === 1 ? -1 : 1;
        }
      }
      const ground = groundAt(v, x);
      y = ground + (star && emerge >= 1 ? hop(((now - born) % 520) / 520, 22) : 0);
      item.place(v, x, y - 12 * (1 - easeOut(emerge)), {
        ground,
        facing: dir,
        rotate: star ? Math.sin(now / 120) * 8 : 0,
      });
      const near = Math.abs(pose.x - x) < 10;
      const level = star
        ? Math.abs(pose.y + 8 - (y + 5)) < 14
        : pose.y - ground < 14;
      if (emerge >= 1 && near && level) {
        caughtAt = now;
        item.remove();
      } else if (now - born > 12000) {
        leaveAt = now;
      }
      return true;
    },
    dispose() {
      item.remove();
      bits.clear();
    },
  };
}

/** Drop into the ledge (or a pill) like a pipe and pop out somewhere else. */
export function pipeWarpAct(stage: Stage, view: ActView): Act {
  const SINK_MS = 380;
  const HIDE_MS = 420;
  const RISE_MS = 440;
  const born = view.now;
  let startAt: number | null = null;
  let x0 = view.pose.x;
  let g0 = 0;
  let x1 = 0;
  let g1 = 0;
  let teleported = false;
  const bits = particles();

  const puff = (now: number, x: number, y: number) => {
    for (let i = 0; i < 4; i++) {
      bits.add(speck(stage.back, 2, 2, "#c9ced6"), now, {
        x,
        y: y + 1,
        vx: (i % 2 ? 1 : -1) * (25 + stage.random() * 25),
        vy: 10 + stage.random() * 25,
        life: 360,
      });
    }
  };

  return {
    kind: "pipeWarp",
    direct(d, now) {
      if (startAt == null) return;
      d.speed = 0;
      d.coins = false;
      const age = now - startAt;
      if (age < SINK_MS) {
        d.pose = { x: x0, y: g0 + exitJumpY(age / SINK_MS, 16, 18), ground: g0 };
      } else if (age < SINK_MS + HIDE_MS) {
        d.pose = { x: x0, y: g0 - 18, ground: g0 };
      } else {
        const t = clamp01((age - SINK_MS - HIDE_MS) / RISE_MS);
        d.pose = { x: x1, y: g1 + exitJumpY(1 - t, 16, 18), ground: g1 };
      }
    },
    draw(v) {
      const { now, pose } = v;
      if (startAt == null) {
        const ground = groundAt(v, pose.x);
        if (Math.abs(pose.y - ground) < 0.5) {
          startAt = now;
          x0 = pose.x;
          g0 = ground;
          const pills = v.platforms
            .map((p) => (p.left + p.right) / 2)
            .filter((c) => Math.abs(c - x0) > 60);
          let target = pills.length ? pick(stage, pills) : v.width - x0;
          if (!pills.length && Math.abs(target - x0) < 60) {
            target = x0 < v.width / 2 ? v.width : 0;
          }
          x1 = clampX(v, target, 10);
          g1 = groundAt(v, x1);
          puff(now, x0, g0);
        }
        bits.step(v);
        return now - born < 3000;
      }
      const age = now - startAt;
      if (!teleported && age >= SINK_MS + HIDE_MS) {
        teleported = true;
        stage.api.teleport(x1);
        puff(now, x1, g1);
      }
      bits.step(v);
      return age < SINK_MS + HIDE_MS + RISE_MS || bits.count > 0;
    },
    dispose: () => bits.clear(),
  };
}

/** A Boo creeps up from behind and hides its face whenever it's seen. */
export function booAct(stage: Stage, view: ActView): Act {
  const boo = sprite(stage.front, SPRITES.boo.map((rows) => art(rows, "#f1f1f1")), 13);
  const born = view.now;
  let x = clampX(view, view.pose.x - view.pose.facing * 44);
  let shyCount = 0;
  let wasShy = false;
  let leaveAt: number | null = null;
  let alpha = 0.9;
  return {
    kind: "boo",
    draw(v) {
      const { now, pose } = v;
      const appear = clamp01((now - born) / 400);
      const shy = toward(pose.x, x) === pose.facing;
      if (leaveAt == null) {
        if (!shy) {
          const gap = Math.abs(pose.x - x) - 16;
          x += toward(x, pose.x) * Math.min(70 * (v.dt / 1000), Math.max(0, gap));
        }
        if (shy && !wasShy) shyCount += 1;
        if ((shyCount >= 3 && !shy) || now - born > 16000) leaveAt = now;
      }
      wasShy = shy;
      alpha += ((shy ? 0.45 : 0.9) - alpha) * Math.min(1, v.dt / 120);
      const fade = leaveAt == null ? 0 : (now - leaveAt) / 450;
      boo.frame(shy ? 1 : 0);
      boo.place(v, x, 26 + Math.sin(now / 320) * 2 + 8 * fade, {
        facing: toward(x, pose.x),
        opacity: alpha * easeOut(appear) * (1 - clamp01(fade)),
      });
      return fade < 1;
    },
    dispose: () => boo.remove(),
  };
}

/** A gust blows the coin behind the mascot, which has to turn back for it. */
export function windGustAct(stage: Stage, view: ActView): Act {
  const born = view.now;
  const CALM = 450;
  const GUST = 1300;
  const coin =
    stage.api.coins().find((c) => c.collectedAt == null && !c.reserved && !c.ride) ??
    stage.api.addCoin(
      clampX(view, view.pose.x + view.pose.facing * 70, COIN_JUMP_LEAD + 8),
      COIN_HOVER,
    );
  const wind: 1 | -1 = view.pose.facing === 1 ? -1 : 1;
  const streaks = Array.from({ length: 5 }, (_, i) => ({
    el: speck(stage.front, 10 + i * 2, 1, "rgba(170,180,190,0.8)"),
    x: stage.random() * view.width,
    y: 14 + stage.random() * 46,
  }));
  let turned = false;
  let runFacing = view.pose.facing;
  return {
    kind: "windGust",
    direct(d, now) {
      const age = now - born;
      if (age < CALM || age > CALM + GUST) return;
      d.speed *= 0.45;
      // Lean into it; the sprite's tilt is mirrored with its facing.
      d.tilt = -wind * 8 * runFacing;
    },
    draw(v) {
      runFacing = v.pose.facing;
      const age = v.now - born;
      const gusting = age >= CALM && age <= CALM + GUST;
      const strength = gusting ? Math.sin(((age - CALM) / GUST) * Math.PI) : 0;
      const lo = RUNNER_INSET + COIN_JUMP_LEAD + 4;
      const hi = v.width - RUNNER_INSET - COIN_JUMP_LEAD - 4;
      if (gusting && coin.collectedAt == null) {
        coin.x = Math.min(hi, Math.max(lo, coin.x + wind * 70 * strength * (v.dt / 1000)));
      }
      for (const s of streaks) {
        s.x += wind * 300 * (v.dt / 1000);
        if (s.x < -20) s.x += v.width + 40;
        if (s.x > v.width + 20) s.x -= v.width + 40;
        placeBox(s.el, v, s.x, s.y, 0.6 * strength);
      }
      if (age > CALM + GUST && !turned) {
        turned = true;
        if (coin.collectedAt == null && (coin.x - v.pose.x) * v.pose.facing < 0) {
          stage.api.turn(toward(v.pose.x, coin.x));
        }
      }
      return age < CALM + GUST + 100;
    },
    dispose() {
      for (const s of streaks) s.el.remove();
    },
  };
}

/** Ah… ah… achoo — knocked back a step by its own sneeze. */
export function sneezeAct(stage: Stage, view: ActView): Act {
  const born = view.now;
  const x0 = view.pose.x;
  const f = view.pose.facing;
  const bits = particles();
  const words: Floater[] = [];
  let sneezed = false;
  const knock = (age: number) => x0 - f * 7 * easeOut((age - 700) / 200);
  return {
    kind: "sneeze",
    direct(d, now) {
      const age = now - born;
      d.speed = 0;
      d.coins = false;
      d.facing = f;
      d.look = "runner-still";
      if (age < 700) {
        const hitch = (start: number) => hop((age - start) / 180, 0.08);
        d.squashY = 1 + hitch(150) + hitch(450);
        d.tilt = -6 * (age / 700);
      } else {
        d.tilt = 10 * (1 - clamp01((age - 700) / 400));
        d.pose = { x: knock(age) };
      }
    },
    draw(v) {
      const age = v.now - born;
      if (age >= 700 && !sneezed) {
        sneezed = true;
        words.push(floater(stage, "achoo!", "#9aa3ad", v.now, x0 + f * 6, v.pose.y + 18, 600));
        for (let i = 0; i < 5; i++) {
          bits.add(speck(stage.front, 2, 2, "#c9ced6"), v.now, {
            x: x0 + f * 9,
            y: v.pose.y + 10,
            vx: f * (50 + stage.random() * 40),
            vy: -10 + stage.random() * 35,
            life: 450,
          });
        }
      }
      bits.step(v);
      drawAll(v, words);
      if (age >= 1500) {
        stage.api.teleport(knock(age));
        return false;
      }
      return true;
    },
    dispose() {
      bits.clear();
      for (const word of words) word.remove();
    },
  };
}

/** A quick dance break, with notes. */
export function danceAct(stage: Stage, view: ActView): Act {
  const BEAT = 250;
  const born = view.now;
  const f = view.pose.facing;
  const notes: { sprite: Sprite; at: number; x: number; y: number }[] = [];
  let nextNote = born;
  let done = false;
  return {
    kind: "dance",
    direct(d, now) {
      const age = now - born;
      d.speed = 0;
      d.coins = false;
      const beat = Math.floor(age / BEAT);
      d.facing = beat % 2 ? (f === 1 ? -1 : 1) : f;
      d.rise = hop((age % BEAT) / BEAT, 5);
    },
    draw(v) {
      const { now, pose } = v;
      const age = now - born;
      if (age < 2000 && now >= nextNote) {
        nextNote = now + 450;
        notes.push({
          sprite: sprite(stage.front, [art(SPRITES.note, pick(stage, SPARKS.slice(0, 4)))], 8),
          at: now,
          x: pose.x + (notes.length % 2 ? 6 : -6),
          y: pose.y + 18,
        });
      }
      for (const note of [...notes]) {
        const t = (now - note.at) / 900;
        if (t >= 1) {
          note.sprite.remove();
          notes.splice(notes.indexOf(note), 1);
          continue;
        }
        note.sprite.place(v, note.x + Math.sin(t * 8) * 3, note.y + 16 * t, { opacity: 1 - t * t });
      }
      if (age >= 2000 && !done) {
        done = true;
        stage.api.turn(f);
      }
      return age < 2000 || notes.length > 0;
    },
    dispose() {
      for (const note of notes) note.sprite.remove();
      stage.api.turn(f);
    },
  };
}

/** A butterfly lands on the mascot's head for a moment. */
export function butterflyAct(stage: Stage, view: ActView): Act {
  const fly = sprite(stage.front, SPRITES.butterfly.map((rows) => art(rows, "#f2a541")), 9);
  const born = view.now;
  const from: 1 | -1 = view.pose.facing;
  let x = from === 1 ? view.width + 6 : -6;
  let y = 44;
  let phase: "approach" | "perch" | "leave" = "approach";
  let phaseAt = born;
  let hold = false;
  let heart: Floater | null = null;
  let runX = view.pose.x;
  return {
    kind: "butterfly",
    direct(d) {
      if (!hold) return;
      d.speed = 0;
      d.coins = false;
      if (phase === "approach") d.facing = toward(runX, x);
      if (phase === "perch") d.look = "runner-still";
    },
    draw(v) {
      const { now, pose } = v;
      runX = pose.x;
      const since = now - phaseAt;
      const headX = pose.x;
      const headY = pose.y + RUNNER_SIZE + 1;
      if (phase === "approach") {
        hold = Math.abs(x - pose.x) < 70;
        const step = 46 * (v.dt / 1000);
        const tx = hold ? headX : pose.x;
        x += Math.max(-step, Math.min(step, tx - x));
        const ty = hold ? headY : 44;
        y += Math.max(-step, Math.min(step, ty - y));
        fly.frame(Math.floor(now / 110));
        fly.place(v, x, y + (hold ? 0 : Math.sin(now / 260) * 6), { facing: toward(pose.x, x) === 1 ? -1 : 1 });
        if (hold && Math.hypot(headX - x, headY - y) < 2) {
          phase = "perch";
          phaseAt = now;
        } else if (since > 9000) {
          phase = "leave";
          phaseAt = now;
        }
        return true;
      }
      if (phase === "perch") {
        fly.frame(since % 600 < 120 ? 0 : 1);
        fly.place(v, headX, headY, {});
        if (since > 400 && !heart) {
          heart = floater(stage, "♥", "#ff6fae", now, headX, headY + 8, 700);
        }
        if (heart && !heart.draw(v)) heart = null;
        if (since > 1600) {
          phase = "leave";
          phaseAt = now;
          hold = false;
          x = headX;
          y = headY;
        }
        return true;
      }
      const t = since / 1000;
      fly.frame(Math.floor(now / 90));
      fly.place(v, x + from * 50 * t, y + 40 * t, { opacity: 1 - t });
      heart?.draw(v);
      return t < 1;
    },
    dispose() {
      fly.remove();
      heart?.remove();
    },
  };
}

/** A banana peel on the ledge; down it goes. */
export function bananaPeelAct(stage: Stage, view: ActView): Act {
  const peel = sprite(stage.back, [art(SPRITES.banana, "#f2d24b")], 10);
  const SLIP = 380;
  const DOWN = 520;
  const UP = 260;
  const born = view.now;
  let px = clampX(view, view.pose.x + view.pose.facing * 80, 14);
  if (Math.abs(px - view.pose.x) < 40) {
    px = clampX(view, view.pose.x - view.pose.facing * 80, 14);
  }
  let slipAt: number | null = null;
  let x0 = 0;
  let f: 1 | -1 = 1;
  let g = 0;
  let peelX = px;
  let peelY = 0;
  let peelVy = 0;
  const stars = [0, 1, 2].map(() => {
    const s = sprite(stage.front, [art(SPRITES.star, "#f4e27a")], 6);
    s.el.style.opacity = "0";
    return s;
  });
  const slid = (age: number) => x0 + f * 16 * easeOut(age / SLIP);

  return {
    kind: "bananaPeel",
    direct(d, now) {
      if (slipAt == null) return;
      const age = now - slipAt;
      d.speed = 0;
      d.coins = false;
      d.facing = f;
      d.look = "runner-still";
      const down =
        age < SLIP
          ? easeOut(age / SLIP)
          : age < SLIP + DOWN
            ? 1
            : 1 - easeInOut((age - SLIP - DOWN) / UP);
      d.tilt = -90 * down;
      d.pose = {
        x: slid(age),
        y: g + 8 * down + (age < SLIP ? hop(age / SLIP, 6) : 0),
      };
    },
    draw(v) {
      const { now, pose } = v;
      if (slipAt == null) {
        g = groundAt(v, px);
        peel.place(v, px, g);
        if (Math.abs(pose.x - px) < 4 && Math.abs(pose.y - g) < 0.5) {
          slipAt = now;
          x0 = pose.x;
          f = pose.facing;
          peelY = g;
          peelVy = 90;
        }
        if (now - born > 10000) return false;
        return true;
      }
      const age = now - slipAt;
      const dt = v.dt / 1000;
      peelVy -= 380 * dt;
      peelX -= f * 70 * dt;
      peelY += peelVy * dt;
      const fade = clamp01(age / 500);
      peel.place(v, peelX, peelY, { rotate: age * 0.9, opacity: 1 - fade });
      const dazed = age > SLIP && age < SLIP + DOWN;
      stars.forEach((s, i) => {
        const a = age / 120 + (i * Math.PI * 2) / 3;
        s.place(v, slid(age) - f * 6 + Math.cos(a) * 7, g + 14 + Math.sin(a) * 3, {
          opacity: dazed ? 1 : 0,
        });
      });
      if (age >= SLIP + DOWN + UP) {
        stage.api.teleport(slid(age));
        return false;
      }
      return true;
    },
    dispose() {
      peel.remove();
      for (const s of stars) s.remove();
    },
  };
}

/** A rain cloud follows the mascot around until it gives up. */
export function rainCloudAct(stage: Stage, view: ActView): Act {
  const cloud = sprite(stage.front, [art(SPRITES.cloud, "#9aa3ad")], 18);
  const born = view.now;
  const LIFE = 3400;
  let x = view.pose.x - view.pose.facing * 30;
  let nextDrop = born + 200;
  const drops = particles();
  return {
    kind: "rainCloud",
    direct(d) {
      d.speed *= 1.4;
    },
    draw(v) {
      const { now, pose } = v;
      const age = now - born;
      x += (pose.x - x) * Math.min(1, (v.dt / 1000) * 3.2);
      const y = 50;
      const raining = age > 200 && age < LIFE;
      if (raining && now >= nextDrop) {
        nextDrop = now + 55;
        const startY = y - 2;
        drops.add(speck(stage.front, 1, 3, "#7cc4ff"), now, {
          x: x - 7 + stage.random() * 14,
          y: startY,
          vx: 0,
          vy: -150,
          life: (startY / 150) * 1000,
        });
      }
      drops.step(v);
      const poof = clamp01((age - LIFE) / 300);
      cloud.place(v, x, y, {
        scale: 1 + 0.4 * poof,
        opacity: clamp01(age / 200) * (1 - poof),
      });
      return poof < 1 || drops.count > 0;
    },
    dispose() {
      cloud.remove();
      drops.clear();
    },
  };
}

/** Gliding backwards for a bit. */
export function moonwalkAct(_stage: Stage, view: ActView): Act {
  const born = view.now;
  return {
    kind: "moonwalk",
    direct(d, now) {
      d.flip = true;
      d.speed *= 0.55;
      d.look = "runner-still";
      d.squashY = 1 + 0.03 * Math.sin((now - born) / 120);
    },
    draw: (v) => v.now - born < 2600,
    dispose() {},
  };
}

/** Late at night: a big stretchy yawn, and a couple of z's. */
export function yawnAct(stage: Stage, view: ActView): Act {
  const born = view.now;
  const zees: { sprite: Sprite; at: number; x: number; y: number; f: 1 | -1 }[] = [];
  return {
    kind: "yawn",
    direct(d, now) {
      const age = now - born;
      d.speed = 0;
      d.coins = false;
      d.look = "runner-still";
      d.squashY =
        age < 700
          ? 1 + 0.12 * easeOut(age / 700)
          : age < 1200
            ? 1.12
            : 1 + 0.12 * (1 - clamp01((age - 1200) / 300));
    },
    draw(v) {
      const { now, pose } = v;
      const age = now - born;
      for (const at of [500, 900]) {
        if (age >= at && zees.length < (at === 500 ? 1 : 2)) {
          zees.push({
            sprite: sprite(stage.front, [art(SPRITES.zee, "#b9c3ff")], 7),
            at: now,
            x: pose.x + pose.facing * 4,
            y: pose.y + 16,
            f: pose.facing,
          });
        }
      }
      for (const z of zees) {
        const t = clamp01((now - z.at) / 1100);
        z.sprite.place(v, z.x + z.f * 6 * t, z.y + 14 * t, { opacity: 1 - t });
      }
      return age < 1800 || zees.some((z) => now - z.at < 1100);
    },
    dispose() {
      for (const z of zees) z.sprite.remove();
    },
  };
}

/** After dark, a few stars twinkle over the ledge. */
export function nightSkyAct(stage: Stage, view: ActView): Act {
  const born = view.now;
  const stars = Array.from({ length: 6 }, (_, i) => ({
    el: speck(stage.back, 2, 2, "#fff7c2"),
    x: (i + 0.2 + stage.random() * 0.6) / 6,
    y: 30 + stage.random() * 34,
    phase: stage.random() * Math.PI * 2,
  }));
  for (const star of stars) star.el.style.boxShadow = "none";
  return {
    kind: "nightSky",
    draw(v) {
      const appear = clamp01((v.now - born) / 1200);
      for (const star of stars) {
        const twinkle = 0.25 + 0.6 * Math.abs(Math.sin(v.now / 650 + star.phase));
        placeBox(star.el, v, RUNNER_INSET + star.x * (v.width - RUNNER_INSET * 2), star.y, twinkle * appear);
      }
      return true;
    },
    dispose() {
      for (const star of stars) star.el.remove();
    },
  };
}
