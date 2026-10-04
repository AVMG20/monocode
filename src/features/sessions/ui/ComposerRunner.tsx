import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  COIN_EDGE_PATH,
  COIN_FACE_PATH,
  COIN_HOVER,
  COIN_SIZE,
  COMPANION_DELAY_MS,
  COMPANION_SIZE,
  COLLECT_POP_MS,
  COLLECT_POP_PX,
  EXIT_MS,
  EXIT_SINK,
  STAR_COUNT,
  STAR_EDGE_PATH,
  STAR_FACE_PATH,
  STAR_SIZE,
  coinCollected,
  companionEnterY,
  exitJumpY,
  hitsChevron,
  jumpHeight,
  nextCoinDelay,
  obstacleFromRects,
  JUMP_LEAD,
  pickCoinX,
  platformHeight,
  platformsFromRects,
  RUNNER_IDLE_SPEED_PX,
  RUNNER_INSET,
  RUNNER_SIZE,
  RUNNER_SPEED_PX,
  poseAt,
  recoilAlong,
  scaleTrackX,
  stepAlong,
  runnerTrack,
  spriteClipBottom,
  stunDone,
  stunShake,
  stunStars,
  trailAt,
  type Obstacle,
  type Platform,
  type RunnerTrack,
  type TrailPoint,
} from "../model/composerRunner";
import { projectKey, projectName } from "../../../shared/lib/paths";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { NO_RUNNER_SIGNALS, type RunnerSignals } from "../model/runnerEvents";
import { createDirector, type Director } from "./runnerDirector";
import {
  baseDirectives,
  type CompanionView,
  type Directives,
  type LiveCoin,
} from "./runnerStage";

export type RunnerCompanion = { id: string; name: string };

type Props = {
  boxRef: RefObject<HTMLElement | null>;
  cwd: string;
  busy: boolean;
  /**
   * The agent itself is at work. With only background commands left the
   * mascot strolls along keeping an eye on them, and stops chasing coins.
   */
  working?: boolean;
  /** Running subagents, trailing the mascot in a line. */
  companions?: RunnerCompanion[];
  /** What the turn is up to, for the events that answer it. */
  signals?: RunnerSignals;
  enabled?: boolean;
  onExited: () => void;
};

const MAX_COMPANIONS = 6;
/** Extra trail kept so a companion can fall behind and catch up. */
const TRAIL_SLACK_MS = 1200;

const COIN_SVG = `<svg viewBox="0 0 8 8" width="${COIN_SIZE}" height="${COIN_SIZE}" shape-rendering="crispEdges" fill="#e8b923" aria-hidden="true"><path class="composer-coin-face" d="${COIN_FACE_PATH}"/><path class="composer-coin-edge" d="${COIN_EDGE_PATH}"/></svg>`;
const STAR_SVG = `<svg viewBox="0 0 8 8" width="${STAR_SIZE}" height="${STAR_SIZE}" shape-rendering="crispEdges" fill="#f4e27a" aria-hidden="true"><path class="composer-coin-face" d="${STAR_FACE_PATH}"/><path class="composer-coin-edge" d="${STAR_EDGE_PATH}"/></svg>`;
const GEOMETRY_SAMPLE_MS = 100;

/**
 * Project pixel mascot running the composer's top ledge while a turn is live.
 * The ledge is whatever is stacked highest on the composer — the dock of
 * subagents and background commands, the queue — and the pills resting on it
 * are steps to hop onto. Running subagents tag along behind it, a coin drops
 * for each one that reports back, and once only background commands are left
 * it slows to a watchful stroll. Now and then something happens on the
 * ledge — see runnerDirector.
 */
export function ComposerRunner({
  boxRef,
  cwd,
  busy,
  working = true,
  companions = [],
  signals = NO_RUNNER_SIGNALS,
  enabled = true,
  onExited,
}: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLDivElement>(null);
  const coinsRef = useRef<HTMLDivElement>(null);
  const starsRef = useRef<HTMLDivElement>(null);
  const companionsRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const signalsRef = useRef(signals);
  signalsRef.current = signals;
  const busyRef = useRef(busy);
  const workingRef = useRef(working);
  const enabledRef = useRef(enabled);
  const onExitedRef = useRef(onExited);
  busyRef.current = busy;
  workingRef.current = working;
  enabledRef.current = enabled;
  onExitedRef.current = onExited;
  // The subagents of a turn that just ended hop off with the mascot rather
  // than vanishing the frame it starts its exit.
  const lastCompanions = useRef(companions);
  if (busy) lastCompanions.current = companions;
  const shownCompanions = (busy ? companions : lastCompanions.current).slice(
    0,
    MAX_COMPANIONS,
  );

  const project = projectName(cwd);
  const key = projectKey(cwd);
  const appearance = useMemo(() => {
    return {
      name: resolveTabGroupMascot(key, loadTabGroupMascots()),
      color: resolveTabGroupColor(
        key,
        loadTabGroupColors(),
        loadTabGroupCustomColors(),
        project,
      ),
    };
  }, [key, project]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const sprite = spriteRef.current;
    const coinLayer = coinsRef.current;
    const starLayer = starsRef.current;
    const companionLayer = companionsRef.current;
    const back = backRef.current;
    const front = frontRef.current;
    if (
      !layer ||
      !sprite ||
      !coinLayer ||
      !starLayer ||
      !companionLayer ||
      !back ||
      !front
    )
      return;

    let along = 0;
    let facing: 1 | -1 = 1;
    let prevWidth = 0;
    let last = performance.now();
    let raf = 0;
    let coinId = 0;
    let nextCoinAt = last + nextCoinDelay(true);
    let exiting = false;
    let exitAt = 0;
    let frozenX = 0;
    let frozenFacing: 1 | -1 = 1;
    let finished = false;
    let stunning = false;
    let stunAt = 0;
    let hitAlong = 0;
    let hitFacing: 1 | -1 = 1;
    let geometryAt = -Infinity;
    let geometryBox: HTMLElement | null = null;
    let cachedTrack: RunnerTrack | null = null;
    let cachedObstacle: Obstacle | null = null;
    let cachedPlatforms: Platform[] = [];
    let frozenBase = 0;
    const trail: TrailPoint[] = [];
    const companionEnteredAt = new Map<string, number>();
    const companionSlots = new Map<string, number>();
    // Last seen element and spot per companion, so one that reports back can
    // run over for a high five after React has already unmounted it.
    const companionEls = new Map<string, HTMLElement>();
    const companionLast = new Map<string, CompanionView>();
    let companionViews: CompanionView[] = [];
    let insetTrack = 0;
    let look = "";
    // Coins earned by subagents reporting back, handed out one at a time.
    let owedCoins = 0;
    const coins: LiveCoin[] = [];
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let learned = reduced;
    // Only a chevron bonk teaches the hop over it; an event's knock does not.
    let stunFromChevron = false;
    // Mid-hop when an event wants to hold still: land first.
    let midHop = false;
    // Star power ran through the chevron; stay through until clear of it.
    let passingThrough = false;
    const startStun = (now: number, chevron = false) => {
      if (stunning) return;
      stunning = true;
      stunFromChevron = chevron;
      stunAt = now;
      hitAlong = along;
      hitFacing = facing;
      sprite.classList.add("mascot-stunned");
    };
    let frameNow = last;
    const starEls = Array.from({ length: STAR_COUNT }, () => {
      const el = document.createElement("div");
      el.className = "absolute top-0 left-0";
      el.style.width = `${STAR_SIZE}px`;
      el.style.height = `${STAR_SIZE}px`;
      el.style.opacity = "0";
      el.style.filter = "drop-shadow(0 1px 0 rgba(0,0,0,0.45))";
      el.style.transform =
        "translate3d(var(--star-x, -64px), var(--star-y, -64px), 0)";
      el.innerHTML = STAR_SVG;
      starLayer.append(el);
      return el;
    });

    const showLayer = (shown: boolean) => {
      layer.style.visibility = shown ? "visible" : "hidden";
    };
    showLayer(false);

    const placeSprite = (
      boxLeft: number,
      boxTop: number,
      x: number,
      y: number,
      facing: 1 | -1,
      shakeX = 0,
      shakeY = 0,
      ground = 0,
    ) => {
      sprite.style.setProperty(
        "--runner-x",
        `${Math.round(boxLeft + x - RUNNER_SIZE / 2 + shakeX)}px`,
      );
      sprite.style.setProperty(
        "--runner-y",
        `${Math.round(boxTop - RUNNER_SIZE - y + 1 + shakeY)}px`,
      );
      sprite.style.setProperty("--runner-facing", String(facing));
      sprite.style.setProperty(
        "--runner-clip",
        `${spriteClipBottom(y - ground)}px`,
      );
    };

    const styleSprite = (d: Directives) => {
      sprite.style.setProperty("--runner-sx", String(d.scale));
      sprite.style.setProperty("--runner-sy", String(d.scale * d.squashY));
      sprite.style.setProperty("--runner-tilt", `${d.tilt}deg`);
      const next = d.look ?? "";
      if (next === look) return;
      if (look) sprite.classList.remove(...look.split(" "));
      if (next) sprite.classList.add(...next.split(" "));
      look = next;
    };

    // Each companion replays the mascot's run a beat behind the one ahead,
    // hopping up from behind the rim when its subagent starts. One leaving
    // means a subagent reported back, which earns the mascot a coin.
    const placeCompanions = (
      now: number,
      dt: number,
      boxLeft: number,
      boxTop: number,
      trackWidth: number,
      lead: TrailPoint,
      tweak?: Directives["companion"],
    ) => {
      const els = companionLayer.children;
      const seen = new Set<string>();
      const views: CompanionView[] = [];
      for (let i = 0; i < els.length; i++) {
        const el = els[i] as HTMLElement;
        const id = el.dataset.companion ?? String(i);
        seen.add(id);
        companionEls.set(id, el);
        let enteredAt = companionEnteredAt.get(id);
        if (enteredAt == null) {
          enteredAt = now;
          companionEnteredAt.set(id, now);
          companionSlots.set(id, i);
        }
        // Close ranks gently when one ahead leaves, instead of teleporting.
        const prevSlot = companionSlots.get(id) ?? i;
        const slot = prevSlot + (i - prevSlot) * Math.min(1, dt / 220);
        companionSlots.set(id, slot);
        let point: TrailPoint;
        if (reduced) {
          // A still mascot: line up on the roomier side, on the ledge.
          const dir = lead.x < trackWidth / 2 ? 1 : -1;
          point = {
            ...lead,
            x: Math.min(
              trackWidth - RUNNER_INSET,
              Math.max(
                RUNNER_INSET,
                lead.x + dir * (i + 1) * (COMPANION_SIZE + 2),
              ),
            ),
          };
        } else {
          point = trailAt(trail, now - (slot + 1) * COMPANION_DELAY_MS) ?? lead;
        }
        let x = point.x;
        let y = point.y + (reduced ? 0 : companionEnterY(now - enteredAt));
        let ground = point.ground ?? 0;
        let pointFacing = point.facing;
        const tweaked = reduced
          ? null
          : tweak?.(id, i, now - (slot + 1) * COMPANION_DELAY_MS);
        if (tweaked) {
          if (tweaked.at != null) {
            const lagged = trailAt(trail, tweaked.at) ?? point;
            x = lagged.x;
            y += lagged.y - point.y;
            ground = lagged.ground ?? 0;
          }
          const mix = tweaked.mix ?? 1;
          if (tweaked.x != null) x += (tweaked.x - x) * mix;
          if (tweaked.y != null) {
            y += (tweaked.y - y) * mix;
            ground = Math.min(ground, y);
          }
          y += tweaked.dy ?? 0;
          if (tweaked.facing) pointFacing = tweaked.facing;
        }
        el.style.setProperty(
          "--runner-x",
          `${Math.round(boxLeft + x - COMPANION_SIZE / 2)}px`,
        );
        el.style.setProperty(
          "--runner-y",
          `${Math.round(boxTop - COMPANION_SIZE - y + 1)}px`,
        );
        el.style.setProperty("--runner-facing", String(pointFacing));
        el.style.setProperty(
          "--runner-clip",
          `${spriteClipBottom(y - ground, COMPANION_SIZE)}px`,
        );
        const view = { id, index: i, x, y, facing: pointFacing };
        views.push(view);
        companionLast.set(id, view);
      }
      for (const id of [...companionEnteredAt.keys()]) {
        if (seen.has(id)) continue;
        companionEnteredAt.delete(id);
        companionSlots.delete(id);
        const el = companionEls.get(id);
        const lastSeen = companionLast.get(id);
        companionEls.delete(id);
        companionLast.delete(id);
        if (busyRef.current && workingRef.current) {
          owedCoins += 1;
          nextCoinAt = Math.min(nextCoinAt, now + 250);
          if (director && el && lastSeen) {
            const clone = el.cloneNode(true) as HTMLElement;
            delete clone.dataset.companion;
            director.companionLeft(clone, lastSeen);
          }
        }
      }
      const keep =
        now - (MAX_COMPANIONS + 1) * COMPANION_DELAY_MS - TRAIL_SLACK_MS;
      while (trail.length > 2 && trail[1].at < keep) trail.shift();
      companionViews = views;
    };

    const record = (
      now: number,
      x: number,
      y: number,
      facing: 1 | -1,
      ground = 0,
    ) => {
      const point = { at: now, x, y, facing, ground };
      trail.push(point);
      return point;
    };

    const hideStars = () => {
      for (const el of starEls) el.style.opacity = "0";
    };

    const placeStars = (
      boxLeft: number,
      boxTop: number,
      x: number,
      y: number,
      elapsed: number,
      shakeX = 0,
      shakeY = 0,
    ) => {
      const spriteLeft = boxLeft + x - RUNNER_SIZE / 2 + shakeX;
      const spriteTop = boxTop - RUNNER_SIZE - y + 1 + shakeY;
      const poses = stunStars(elapsed);
      for (let i = 0; i < starEls.length; i++) {
        const el = starEls[i];
        const star = poses[i];
        if (!star) {
          el.style.opacity = "0";
          continue;
        }
        el.style.setProperty(
          "--star-x",
          `${Math.round(spriteLeft + star.dx)}px`,
        );
        el.style.setProperty(
          "--star-y",
          `${Math.round(spriteTop + star.dy)}px`,
        );
        el.style.opacity = String(star.opacity);
      }
    };

    const endStun = () => {
      stunning = false;
      sprite.classList.remove("mascot-stunned");
      hideStars();
    };

    const clearCoins = () => {
      for (const coin of coins) coin.el.remove();
      coins.length = 0;
    };

    const addCoin = (
      x: number,
      height: number,
      options: { ride?: boolean; reserved?: boolean } = {},
    ): LiveCoin => {
      const el = document.createElement("div");
      el.className = "absolute top-0 left-0";
      el.style.width = `${COIN_SIZE}px`;
      el.style.height = `${COIN_SIZE}px`;
      el.style.transform =
        "translate3d(var(--coin-x, -64px), var(--coin-y, -64px), 0)";
      el.style.filter = "drop-shadow(0 1px 0 rgba(0,0,0,0.45))";
      el.innerHTML = COIN_SVG;
      coinLayer.append(el);
      const coin: LiveCoin = {
        id: ++coinId,
        x,
        height,
        el,
        collectedAt: null,
        ...options,
      };
      coins.push(coin);
      return coin;
    };

    const director: Director | null = reduced
      ? null
      : createDirector({
          back,
          front,
          layer,
          random: Math.random,
          api: {
            stun: () => startStun(frameNow),
            addCoin,
            coins: () => coins,
            turn: (next) => {
              facing = next;
            },
            teleport: (x) => {
              along = Math.min(insetTrack, Math.max(0, x - RUNNER_INSET));
            },
          },
        });

    const resetStage = () => {
      director?.clear();
      styleSprite(baseDirectives());
    };

    const apply = (now: number) => {
      const dt = Math.min(now - last, 48);
      last = now;
      frameNow = now;

      const box = boxRef.current;
      if (!enabledRef.current) {
        showLayer(false);
        endStun();
        if (!busyRef.current && !finished) {
          finished = true;
          resetStage();
          clearCoins();
          onExitedRef.current();
        }
        return;
      }
      if (!box || document.hidden) {
        showLayer(false);
        return;
      }

      // Reading layout every animation frame forces WebKit to flush changes
      // when a new transcript block arrives. The runner can animate from the
      // last measured track while geometry is refreshed at a lower rate.
      if (box !== geometryBox || now - geometryAt >= GEOMETRY_SAMPLE_MS) {
        const shell = box.closest("[data-composer]");
        const review = shell?.querySelector("[data-session-review]");
        const dock = shell?.querySelector("[data-background-tasks-card]");
        const queue = shell?.querySelector("[data-message-queue-card]");
        const ledge = review ?? dock ?? queue;
        cachedTrack = runnerTrack(
          box.getBoundingClientRect(),
          ledge?.getBoundingClientRect() ?? null,
        );
        cachedPlatforms = platformsFromRects(
          cachedTrack,
          [...(shell?.querySelectorAll("[data-session-artifact]") ?? [])].map(
            (pill) => pill.getBoundingClientRect(),
          ),
        );
        const pane = box.closest("[data-session-drop]");
        const button = pane?.querySelector("[data-jump-to-bottom]");
        cachedObstacle = obstacleFromRects(
          {
            left: cachedTrack.left,
            right: cachedTrack.left + cachedTrack.width,
            top: cachedTrack.top,
            bottom: cachedTrack.top + 8,
            width: cachedTrack.width,
          },
          button?.getBoundingClientRect() ?? null,
        );
        geometryBox = box;
        geometryAt = now;
      }
      const track = cachedTrack;
      if (!track) return;
      if (track.width <= 0) {
        showLayer(false);
        return;
      }
      showLayer(true);

      insetTrack = Math.max(0, track.width - RUNNER_INSET * 2);
      if (prevWidth > 0 && prevWidth !== track.width) {
        const prevInset = Math.max(0, prevWidth - RUNNER_INSET * 2);
        along = scaleTrackX(along, prevInset, insetTrack);
        hitAlong = scaleTrackX(hitAlong, prevInset, insetTrack);
        frozenX = scaleTrackX(frozenX, prevWidth, track.width);
        for (const coin of coins) {
          coin.x = scaleTrackX(coin.x, prevWidth, track.width);
        }
        for (const point of trail) {
          point.x = scaleTrackX(point.x, prevWidth, track.width);
        }
      }
      prevWidth = track.width;

      let d = baseDirectives();
      let bounced = false;
      if (busyRef.current) {
        if (exiting) {
          exiting = false;
          learned = reduced;
          endStun();
        }
        finished = false;
        if (director) d = director.direct(now);
        const speed = midHop ? Math.max(1, d.speed) : d.speed;
        if (!reduced && !stunning && speed > 0) {
          const stepped = stepAlong(
            along,
            facing,
            dt,
            insetTrack,
            (workingRef.current ? RUNNER_SPEED_PX : RUNNER_IDLE_SPEED_PX) *
              speed,
          );
          bounced = stepped.facing !== facing;
          along = stepped.along;
          facing = stepped.facing;
        }
        if (d.facing && !stunning && !midHop) facing = d.facing;
      } else if (!exiting && !finished) {
        exiting = true;
        exitAt = now;
        resetStage();
        endStun();
        const current = poseAt(
          along,
          facing,
          track.width,
          null,
          [],
          RUNNER_INSET,
          cachedPlatforms,
        );
        frozenX = current.x;
        frozenFacing = current.facing;
        frozenBase = current.y;
        for (const coin of coins) {
          if (coin.collectedAt == null) coin.collectedAt = now;
        }
      }

      if (exiting) {
        const t = reduced ? 1 : Math.min(1, (now - exitAt) / EXIT_MS);
        // Hop off from wherever it stood. Standing on a pill, it drops into
        // the pill like a pipe instead of falling through it.
        const y = frozenBase + (reduced ? -EXIT_SINK : exitJumpY(t));
        placeSprite(
          track.left,
          track.top,
          frozenX,
          y,
          frozenFacing,
          0,
          0,
          frozenBase,
        );
        placeCompanions(
          now,
          dt,
          track.left,
          track.top,
          track.width,
          record(now, frozenX, y, frozenFacing, frozenBase),
        );
        for (const coin of [...coins]) {
          const pop = Math.min(
            1,
            (now - (coin.collectedAt ?? now)) / COLLECT_POP_MS,
          );
          coin.el.style.opacity = String(1 - pop);
          if (pop >= 1) {
            coin.el.remove();
            coins.splice(coins.indexOf(coin), 1);
          }
        }
        if (t >= 1 && !finished) {
          finished = true;
          clearCoins();
          onExitedRef.current();
        }
        return;
      }

      const overlapsChevron =
        cachedObstacle != null &&
        Math.abs(
          RUNNER_INSET +
            along -
            (cachedObstacle.left + cachedObstacle.right) / 2,
        ) <
          (cachedObstacle.right - cachedObstacle.left) / 2 +
            RUNNER_SIZE / 2 +
            JUMP_LEAD;
      passingThrough = d.invincible || (passingThrough && overlapsChevron);
      const obstacle = passingThrough ? null : cachedObstacle;
      const platforms = d.platforms.length
        ? [...cachedPlatforms, ...d.platforms]
        : cachedPlatforms;
      if (stunning) {
        along = recoilAlong(hitAlong, hitFacing, now - stunAt, insetTrack);
        facing = hitFacing;
        if (stunDone(now - stunAt)) {
          if (stunFromChevron) learned = true;
          endStun();
        }
      }

      for (const coin of coins) {
        if (
          coin.collectedAt == null &&
          (coin.x < RUNNER_INSET || coin.x > track.width - RUNNER_INSET)
        ) {
          coin.collectedAt = now;
        }
      }
      // Keep grabbed coins in the pose so the hop finishes instead of snapping
      // back to the rim the frame they are collected. Skip the chevron hop
      // until the mascot has bonked it once this turn.
      const pose = poseAt(
        along,
        facing,
        track.width,
        learned ? obstacle : null,
        stunning ? [] : coins.filter((coin) => !coin.ride),
        RUNNER_INSET,
        platforms,
      );
      midHop =
        d.speed < 1 && pose.y - platformHeight(pose.x, platforms) > 0.5;
      for (const lift of d.lifts) pose.y = Math.max(pose.y, lift(pose.x));
      pose.y += d.rise;
      let ground = 0;
      if (d.pose) {
        pose.x = d.pose.x ?? pose.x;
        pose.y = d.pose.y ?? pose.y;
        ground = d.pose.ground ?? 0;
      }
      pose.airborne = pose.y - platformHeight(pose.x, platforms) > 0.5;
      if (
        !stunning &&
        hitsChevron(pose.x, pose.y, pose.facing, obstacle, learned)
      ) {
        startStun(now, true);
      }
      const shake = stunning ? stunShake(now - stunAt) : { x: 0, y: 0 };
      if (stunning) {
        placeStars(
          track.left,
          track.top,
          pose.x,
          pose.y,
          now - stunAt,
          shake.x,
          shake.y,
        );
      } else {
        hideStars();
      }
      const hasLive = coins.some((coin) => coin.collectedAt == null);

      if (
        !reduced &&
        !stunning &&
        !hasLive &&
        d.coins &&
        workingRef.current &&
        now >= nextCoinAt
      ) {
        const x = pickCoinX(track.width, pose.x, obstacle);
        if (x != null) {
          owedCoins = Math.max(0, owedCoins - 1);
          addCoin(x, COIN_HOVER);
        } else {
          nextCoinAt = now + 2000;
        }
      }

      for (const coin of [...coins]) {
        if (
          !stunning &&
          !coin.reserved &&
          coin.collectedAt == null &&
          coinCollected(pose, coin)
        ) {
          coin.collectedAt = now;
          nextCoinAt = owedCoins > 0 ? now + 400 : now + nextCoinDelay(false);
        }

        const bob = coin.collectedAt == null ? Math.sin(now / 180) * 2 : 0;
        const pop =
          coin.collectedAt == null
            ? 0
            : Math.min(1, (now - coin.collectedAt) / COLLECT_POP_MS);
        coin.el.style.setProperty(
          "--coin-x",
          `${Math.round(track.left + coin.x - COIN_SIZE / 2)}px`,
        );
        coin.el.style.setProperty(
          "--coin-y",
          `${Math.round(track.top - coin.height - COIN_SIZE / 2 - bob - COLLECT_POP_PX * pop)}px`,
        );
        coin.el.style.opacity = String(1 - pop);
        if (pop >= 1) coin.el.remove();
        if (
          pop >= 1 &&
          (coin.ride || jumpHeight(pose.x, null, [coin]) <= 0.5)
        ) {
          coins.splice(coins.indexOf(coin), 1);
        }
      }

      placeSprite(
        track.left,
        track.top,
        pose.x,
        pose.y,
        d.flip ? (pose.facing === 1 ? -1 : 1) : pose.facing,
        shake.x,
        shake.y,
        ground,
      );
      styleSprite(d);
      placeCompanions(
        now,
        dt,
        track.left,
        track.top,
        track.width,
        record(now, pose.x, pose.y, pose.facing, ground),
        d.companion,
      );
      director?.frame(
        {
          now,
          dt,
          left: track.left,
          top: track.top,
          width: track.width,
          pose,
          platforms,
          companions: companionViews,
        },
        {
          signals: signalsRef.current,
          working: workingRef.current,
          bounced,
        },
      );
    };

    apply(last);
    const tick = (now: number) => {
      apply(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      resetStage();
      clearCoins();
      showLayer(false);
    };
  }, [boxRef]);

  return createPortal(
    <div
      ref={layerRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 overflow-visible"
      style={{ visibility: "hidden" }}
    >
      <div ref={backRef} className="absolute inset-0" />
      <div ref={coinsRef} className="absolute inset-0" />
      <div ref={companionsRef} className="absolute inset-0">
        {shownCompanions.map((companion) => (
          <div
            key={companion.id}
            data-companion={companion.id}
            className="absolute top-0 left-0 origin-bottom drop-shadow-[0_1px_0_rgba(0,0,0,0.45)] will-change-transform"
            style={{
              width: COMPANION_SIZE,
              height: COMPANION_SIZE,
              transform:
                "translate3d(var(--runner-x, -64px), var(--runner-y, -64px), 0) scaleX(var(--runner-facing, 1))",
              clipPath: "inset(0 0 var(--runner-clip, 0px) 0)",
            }}
          >
            <ProjectMascot
              project={companion.name}
              className="size-3 text-content/80"
              active
            />
          </div>
        ))}
      </div>
      <div
        ref={spriteRef}
        className="absolute top-0 left-0 origin-bottom drop-shadow-[0_1px_0_rgba(0,0,0,0.45)] will-change-transform"
        style={{
          width: RUNNER_SIZE,
          height: RUNNER_SIZE,
          transform:
            "translate3d(var(--runner-x, -64px), var(--runner-y, -64px), 0) scaleX(var(--runner-facing, 1)) scale(var(--runner-sx, 1), var(--runner-sy, 1)) rotate(var(--runner-tilt, 0deg))",
          clipPath: "inset(0 0 var(--runner-clip, 0px) 0)",
        }}
      >
        <ProjectMascot
          project={project}
          name={appearance.name}
          color={appearance.color}
          className="size-4"
          active
        />
      </div>
      <div ref={starsRef} className="absolute inset-0" />
      <div ref={frontRef} className="absolute inset-0" />
    </div>,
    document.body,
  );
}
