// WebKit (WebKitGTK MiniBrowser under Xvfb; MINIBROWSER overrides its path) run of
// the self-driving benchmark. The desktop app renders with WebKit, which pays for
// some CSS (notably `:has()` invalidation) far more than Chromium does.
//   node wk.cjs <checkout> [--runs 3] [--auto s1,s2,s3] [--query rich&filler=150&projects=6] [--out f.json]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const serve = require("./serve.cjs");
const argv = process.argv.slice(2);
const dir = argv[0];
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const runs = Number(opt("runs", 3));
const auto = opt("auto", "s1,s2,s3");
const query = opt("query", "");
const out = opt("out", null);
const stream = auto.includes("s4") || auto.includes("s5");

const stats = (samples) => {
  if (!samples.length) return null;
  const s = [...samples].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)];
  return { n: s.length, median: +q(0.5).toFixed(1), p90: +q(0.9).toFixed(1), max: +s[s.length - 1].toFixed(1) };
};

async function once(server) {
  const port = server.address().port;
  const params = [`auto=${auto}`, stream ? "stream" : "", query].filter(Boolean).join("&");
  const url = `http://127.0.0.1:${port}/tests/browser/nav-bench.html?${params}`;
  const child = spawn(
    "xvfb-run",
    ["-a", "-s", "-screen 0 1600x1000x24", process.env.MINIBROWSER ?? "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser", "--private", url],
    { detached: true, stdio: "ignore" },
  );
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 300000);
      server.once("result", (body) => {
        clearTimeout(timer);
        resolve(JSON.parse(body));
      });
    });
  } finally {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
}

(async () => {
  const server = await serve(`${dir}/dist-navbench`);
  const all = [];
  for (let i = 0; i < runs; i++) {
    const r = await once(server);
    if (r.error) console.error(r.error);
    all.push(r);
  }
  const pick = (f) => all.flatMap(f);
  const groups = {
    s1_cold: pick((r) => (r.s1 ?? []).filter((x) => x.visit < 6)),
    s1_warm: pick((r) => (r.s1 ?? []).filter((x) => x.visit >= 6)),
    s2_toBeta: pick((r) => (r.s2 ?? []).filter((x) => x.to === "beta")),
    s2_toAlpha: pick((r) => (r.s2 ?? []).filter((x) => x.to === "alpha")),
    s3_open: pick((r) => (r.s3 ?? []).filter((x) => !x.missing)),
  };
  const med = (list, key) => {
    const v = list.map((x) => x[key]).filter((x) => x != null).sort((a, b) => a - b);
    return v.length ? +v[Math.floor(v.length / 2)].toFixed(1) : null;
  };
  const summary = { ua: all[0]?.ua, dropped: all[0]?.dropped?.length, s4: all.map((r) => r.s4).filter(Boolean) };
  for (const [name, list] of Object.entries(groups)) {
    if (!list.length) continue;
    summary[name] = {
      ...stats(list.map((x) => x.ms)),
      react: med(list, "react"),
      sync: med(list, "sync"),
      layout: med(list, "layout"),
      worstFrame: med(list, "worst"),
      commitStyle: med(list, "commitStyle"),
      commitLayout: med(list, "commitLayout"),
    };
  }
  console.log(JSON.stringify(summary));
  if (out) fs.writeFileSync(out, JSON.stringify({ summary, all }, null, 1));
  server.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
