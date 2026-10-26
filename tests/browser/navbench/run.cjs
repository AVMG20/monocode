// Navigation benchmark runner.
//   node run.cjs <checkout> [--runs 3] [--only s1,s2,s3,s4] [--out file.json]
// Expects <checkout>/dist-navbench built by build.sh.
const { chromium } = require("playwright");
const fs = require("node:fs");
const serve = require("./serve.cjs");

const argv = process.argv.slice(2);
const dir = argv[0];
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const runs = Number(opt("runs", 3));
const only = new Set(opt("only", "s1,s2,s3,s4").split(","));
const out = opt("out", null);
const settle = Number(opt("settle", 600));
const extraQuery = opt("query", "");

const stats = (samples) => {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return {
    n: sorted.length,
    median: +q(0.5).toFixed(1),
    p90: +q(0.9).toFixed(1),
    max: +sorted[sorted.length - 1].toFixed(1),
  };
};

async function collectWindow(page, from) {
  return page.evaluate((from) => {
    const fiber = window.benchFiber;
    const top = [...fiber.stats.entries()]
      .map(([name, v]) => ({ name, renders: v.renders, self: +v.self.toFixed(1) }))
      .sort((a, b) => b.self - a.self)
      .slice(0, 15);
    const commits = fiber.commits.filter((c) => c.at >= from);
    const tasks = window.benchLong.tasks.filter((t) => t.start >= from);
    const frames = window.benchLong.frames.filter((f) => f.start >= from);
    const scripts = new Map();
    for (const frame of frames)
      for (const s of frame.scripts) {
        const key = `${s.invoker} | ${s.fn} | ${s.url}:${s.pos}`;
        const e = scripts.get(key) ?? { key, duration: 0, layout: 0, count: 0 };
        e.duration += s.duration;
        e.layout += s.forcedStyleAndLayout || 0;
        e.count++;
        scripts.set(key, e);
      }
    return {
      top,
      commits: commits.length,
      commitMs: +commits.reduce((a, c) => a + c.duration, 0).toFixed(1),
      workspaceCommits: commits.filter((c) => c.hits.Workspace).length,
      sidebarCommits: commits.filter((c) => c.hits.SidebarComponent).length,
      longTasks: tasks.length,
      longTaskMs: +tasks.reduce((a, t) => a + t.duration, 0).toFixed(0),
      longestTask: +Math.max(0, ...tasks.map((t) => t.duration)).toFixed(0),
      loafScripts: [...scripts.values()]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 8)
        .map((e) => ({ ...e, duration: +e.duration.toFixed(0), layout: +e.layout.toFixed(0) })),
    };
  }, from);
}

const now = (page) => page.evaluate(() => performance.now());
const resetFiber = (page) => page.evaluate(() => window.benchFiber.reset());

async function armWait(page, ids, timeout = 5000) {
  await page.evaluate(
    ({ ids, timeout }) => {
      window.benchResult = null;
      const started = performance.now();
      const tick = () => {
        // Arm before the input; the measured start is the input event itself.
        const at = window.benchInputAt ?? 0;
        if (performance.now() - started > timeout + 2000) {
          window.benchResult = { ms: timeout, id: null };
          return;
        }
        const hit = at > started ? ids.find((id) => window.bench.painted(id)) : undefined;
        if (!hit) return requestAnimationFrame(tick);
        requestAnimationFrame(() => {
          window.benchResult = { ms: performance.now() - at, id: hit };
        });
      };
      requestAnimationFrame(tick);
    },
    { ids, timeout },
  );
}
async function result(page) {
  await page.waitForFunction(() => window.benchResult !== null, null, { timeout: 15000 });
  return page.evaluate(() => window.benchResult);
}

async function openPage(browser, query = "") {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    for (const type of ["keydown", "pointerdown"])
      window.addEventListener(type, () => (window.benchInputAt = performance.now()), true);
  });
  const q = [query, extraQuery].filter(Boolean).join("&");
  await page.goto(`${base}/tests/browser/nav-bench.html${q ? `?${q}` : ""}`);
  await page.waitForFunction(() => window.bench?.painted("workspace-session-0"), null, {
    timeout: 60000,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  return { page, errors };
}

let base;
(async () => {
  const server = await serve(`${dir}/dist-navbench`);
  base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const report = { dir, runs, s1: { cold: [], warm: [] }, s2: { toBeta: [], toAlpha: [] }, s3: [], s4: [], attribution: {}, errors: [] };

  for (let run = 0; run < runs; run++) {
    const { page, errors } = await openPage(browser);
    if (only.has("s1")) {
      await resetFiber(page);
      const from = await now(page);
      for (let visit = 0; visit < 18; visit++) {
        const index = (visit + 1) % 6;
        await armWait(page, [`workspace-session-${index}`]);
        await page.keyboard.press(`Meta+${index + 1}`);
        const r = await result(page);
        (visit < 6 ? report.s1.cold : report.s1.warm).push(r.ms);
        await page.waitForTimeout(settle);
      }
      if (run === 0) report.attribution.s1 = await collectWindow(page, from);
    }
    if (only.has("s2")) {
      // Start from the alpha project with session 1 on screen.
      await resetFiber(page);
      const from = await now(page);
      const sidebar = page.locator("aside, nav, [class*=sidebar]").first();
      for (let i = 0; i < 6; i++) {
        await armWait(page, ["beta-session-0", "beta-session-1"]);
        await page.getByText("beta", { exact: true }).first().click();
        report.s2.toBeta.push((await result(page)).ms);
        await page.waitForTimeout(settle);
        await armWait(page, Array.from({ length: 6 }, (_, k) => `workspace-session-${k}`));
        await page.getByText("alpha", { exact: true }).first().click();
        report.s2.toAlpha.push((await result(page)).ms);
        await page.waitForTimeout(settle);
      }
      void sidebar;
      if (run === 0) report.attribution.s2 = await collectWindow(page, from);
    }
    if (only.has("s3")) {
      await resetFiber(page);
      const from = await now(page);
      for (let k = 0; k < 6; k++) {
        const n = 12 - k - run * 0; // newest archives first; each is cold in this page
        const id = `history-session-${n - 1}`;
        const row = page.getByText(`Archive ${n}`, { exact: true }).first();
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        await armWait(page, [id], 8000);
        await row.click();
        report.s3.push((await result(page)).ms);
        await page.waitForTimeout(settle);
      }
      if (run === 0) report.attribution.s3 = await collectWindow(page, from);
    }
    report.errors.push(...errors.slice(0, 5));
    await page.close();

    if (only.has("s5")) {
      // Navigation while one session streams (the user's agents keep running).
      const { page, errors } = await openPage(browser, "stream");
      if (!(await page.evaluate(() => window.bench.hasQueue()))) {
        await page.keyboard.press("Meta+2");
        await page.waitForTimeout(500);
        await page.keyboard.press("Meta+1");
        await page.waitForTimeout(500);
      }
      await page.evaluate(() => window.bench.startStream("workspace-session-0"));
      await page.waitForTimeout(1500);
      report.s5 ??= { tabs: [], toBeta: [], toAlpha: [] };
      for (let visit = 0; visit < 12; visit++) {
        const index = (visit + 1) % 6;
        await armWait(page, [`workspace-session-${index}`]);
        await page.keyboard.press(`Meta+${index + 1}`);
        const r = await result(page);
        if (visit >= 6) report.s5.tabs.push(r.ms);
        await page.waitForTimeout(settle);
      }
      for (let i = 0; i < 4; i++) {
        await armWait(page, ["beta-session-0", "beta-session-1"]);
        await page.getByText("beta", { exact: true }).first().click();
        report.s5.toBeta.push((await result(page)).ms);
        await page.waitForTimeout(settle);
        await armWait(page, Array.from({ length: 6 }, (_, k) => `workspace-session-${k}`));
        await page.getByText("alpha", { exact: true }).first().click();
        report.s5.toAlpha.push((await result(page)).ms);
        await page.waitForTimeout(settle);
      }
      await page.evaluate(() => window.bench.stopStream("workspace-session-0"));
      report.errors.push(...errors.slice(0, 5));
      await page.close();
    }
    if (only.has("s4")) {
      const { page, errors } = await openPage(browser, "stream");
      if (!(await page.evaluate(() => window.bench.hasQueue()))) {
        await page.keyboard.press("Meta+2");
        await page.waitForTimeout(500);
        await page.keyboard.press("Meta+1");
        await page.waitForTimeout(500);
      }
      const phases = {};
      for (const phase of ["foreground", "background"]) {
        if (phase === "background") {
          await page.keyboard.press("Meta+2");
          await page.waitForTimeout(1000);
        }
        await resetFiber(page);
        const from = await now(page);
        await page.evaluate(() => window.bench.startStream("workspace-session-0"));
        await page.waitForTimeout(10000);
        const to = await now(page);
        const w = await collectWindow(page, from);
        const seconds = (to - from) / 1000;
        phases[phase] = {
          commitsPerSec: +(w.commits / seconds).toFixed(1),
          workspacePerSec: +(w.workspaceCommits / seconds).toFixed(1),
          sidebarPerSec: +(w.sidebarCommits / seconds).toFixed(1),
          commitMsPerSec: +(w.commitMs / seconds).toFixed(1),
          longTasks: w.longTasks,
          longTaskMs: w.longTaskMs,
          longestTask: w.longestTask,
          top: run === 0 ? w.top.slice(0, 10) : undefined,
          loafScripts: run === 0 ? w.loafScripts.slice(0, 5) : undefined,
        };
        await page.evaluate(() => window.bench.stopStream("workspace-session-0"));
        await page.waitForTimeout(1000);
      }
      report.s4.push(phases);
      report.errors.push(...errors.slice(0, 5));
      await page.close();
    }
  }
  report.summary = {
    s1_cold: stats(report.s1.cold),
    s1_warm: stats(report.s1.warm),
    s2_toBeta: stats(report.s2.toBeta),
    s2_toAlpha: stats(report.s2.toAlpha),
    s3_openHistory: stats(report.s3),
    s4: report.s4,
    s5_tabs: report.s5 && stats(report.s5.tabs),
    s5_toBeta: report.s5 && stats(report.s5.toBeta),
    s5_toAlpha: report.s5 && stats(report.s5.toAlpha),
  };
  console.log(JSON.stringify(report.summary, null, 1));
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));
  await browser.close();
  server.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
