// Style/layout cost per navigation from a Chromium trace.
//   node trace.cjs <checkout> [--query ...] [--out file.json]
// For each action (input -> transcript painted) it sums UpdateLayoutTree
// (style recalc: duration and elements restyled) and Layout (duration and
// objects laid out), plus scripting, so engine-independent work is visible.
const { chromium } = require("playwright");
const fs = require("node:fs");
const serve = require("./serve.cjs");
const argv = process.argv.slice(2);
const dir = argv[0];
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const extraQuery = opt("query", "");
const out = opt("out", null);
const only = new Set(opt("only", "s1,s2,s3").split(","));

(async () => {
  const server = await serve(`${dir}/dist-navbench`);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(() => {
    for (const type of ["keydown", "pointerdown"])
      window.addEventListener(
        type,
        (event) => {
          if (event.key === "Meta") return;
          window.benchInputAt = performance.now();
          performance.mark("bench-input");
        },
        true,
      );
  });
  await page.goto(`${base}/tests/browser/nav-bench.html${extraQuery ? `?${extraQuery}` : ""}`);
  await page.waitForFunction(() => window.bench?.painted("workspace-session-0"), null, { timeout: 60000 });
  await page.waitForTimeout(2000);

  const actions = [];
  const arm = (ids) =>
    page.evaluate((ids) => {
      window.benchResult = null;
      const started = performance.now();
      const tick = () => {
        const at = window.benchInputAt ?? 0;
        if (performance.now() - started > 8000) return (window.benchResult = { ms: 8000 });
        const hit = at > started ? ids.find((id) => window.bench.painted(id)) : undefined;
        if (!hit) return requestAnimationFrame(tick);
        requestAnimationFrame(() => {
          performance.mark("bench-painted");
          window.benchResult = { ms: performance.now() - at };
        });
      };
      requestAnimationFrame(tick);
    }, ids);
  const done = async (label) => {
    await page.waitForFunction(() => window.benchResult !== null, null, { timeout: 15000 });
    actions.push({ label, ms: (await page.evaluate(() => window.benchResult)).ms });
    await page.waitForTimeout(700);
  };

  await browser.startTracing(page, {
    categories: ["devtools.timeline", "blink.user_timing", "disabled-by-default-devtools.timeline"],
  });
  if (only.has("s1"))
    for (let visit = 0; visit < 12; visit++) {
      const index = (visit + 1) % 6;
      await arm([`workspace-session-${index}`]);
      await page.keyboard.press(`Meta+${index + 1}`);
      await done(visit < 6 ? "s1-cold" : "s1-warm");
    }
  if (only.has("s2"))
    for (let i = 0; i < 4; i++) {
      await arm(["beta-session-0", "beta-session-1"]);
      await page.getByText("beta", { exact: true }).first().click();
      await done("s2-beta");
      await arm(Array.from({ length: 6 }, (_, k) => `workspace-session-${k}`));
      await page.getByText("alpha", { exact: true }).first().click();
      await done("s2-alpha");
    }
  if (only.has("s3"))
    for (let k = 0; k < 4; k++) {
      const n = 12 - k;
      const row = page.getByText(`Archive ${n}`, { exact: true }).first();
      await row.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await arm([`history-session-${n - 1}`]);
      await row.click();
      await done("s3-open");
    }
  const buffer = await browser.stopTracing();
  const events = JSON.parse(buffer.toString()).traceEvents;
  const marks = events
    .filter((e) => e.name === "bench-input" || e.name === "bench-painted")
    .sort((a, b) => a.ts - b.ts);
  // Pair each painted mark with the last input before it.
  const windows = [];
  let lastInput = null;
  for (const m of marks) {
    if (m.name === "bench-input") lastInput = m.ts;
    else if (lastInput != null) {
      windows.push([lastInput, m.ts]);
      lastInput = null;
    }
  }
  const mainPid = marks[0]?.pid;
  const mainTid = events.find((e) => e.pid === mainPid && e.name === "UpdateLayoutTree")?.tid;
  const main = events.filter((e) => e.ph === "X" && e.dur && e.pid === mainPid && e.tid === mainTid);
  const perAction = windows.map(([from, to], i) => {
    const inWin = main.filter((e) => e.ts >= from && e.ts <= to);
    const sum = (name, f = (e) => e.dur) =>
      inWin.filter((e) => e.name === name).reduce((a, e) => a + f(e), 0);
    return {
      label: actions[i]?.label,
      ms: +(actions[i]?.ms ?? 0).toFixed(1),
      styleMs: +(sum("UpdateLayoutTree") / 1000).toFixed(1),
      styleElements: sum("UpdateLayoutTree", (e) => e.args?.elementCount ?? 0),
      layoutMs: +(sum("Layout") / 1000).toFixed(1),
      layoutObjects: sum("Layout", (e) => e.args?.beginData?.dirtyObjects ?? 0),
      scriptMs: +(sum("FunctionCall") / 1000 + sum("EventDispatch") / 1000).toFixed(1),
      paintMs: +((sum("Paint") + sum("PrePaint")) / 1000).toFixed(1),
    };
  });
  const byLabel = {};
  for (const a of perAction) (byLabel[a.label] ??= []).push(a);
  const med = (list, key) => {
    const s = list.map((x) => x[key]).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const summary = Object.fromEntries(
    Object.entries(byLabel).map(([label, list]) => [
      label,
      Object.fromEntries(
        ["ms", "styleMs", "styleElements", "layoutMs", "layoutObjects", "scriptMs", "paintMs"].map((k) => [k, med(list, k)]),
      ),
    ]),
  );
  console.log(JSON.stringify(summary));
  if (out) fs.writeFileSync(out, JSON.stringify({ summary, perAction }, null, 1));
  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
