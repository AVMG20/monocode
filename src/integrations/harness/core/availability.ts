import type { HarnessId } from "../../../features/sessions/model/session";
import { HARNESSES } from "../../../features/sessions/model/session";
import { listNativeProviders } from "../../../platform/tauri/nativeSession";
import {
  emitHarnessAvailability,
  harnessAvailabilityProbedAt,
  markHarnessAvailabilityProbed,
  setHarnessAvailability,
  type HarnessAvailability,
} from "./availabilityState";

export type { HarnessAvailability } from "./availabilityState";
export {
  getHarnessAvailabilitySnapshot,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  subscribeHarnessAvailability,
} from "./availabilityState";

/**
 * We only ever check whether the binary exists, never whether it is
 * authenticated, so the hint must not blame a login.
 */
const CLI: Record<HarnessId, { name: string; install?: string }> = {
  claude: { name: "Claude Code CLI" },
  codex: { name: "Codex CLI" },
  cursor: { name: "Cursor CLI" },
  grok: {
    name: "Grok Build CLI",
    install: "curl -fsSL https://x.ai/cli/install.sh | bash",
  },
  opencode: { name: "OpenCode CLI" },
  pi: { name: "Pi CLI", install: "npm i -g @earendil-works/pi-coding-agent" },
  omp: { name: "omp CLI", install: "curl -fsSL https://omp.sh/install | sh" },
  fx: { name: "fx CLI", install: "curl -fsSL https://fx.sh/setup.sh | bash" },
  hermes: {
    name: "Hermes Agent CLI",
    install:
      "Install from hermes-agent.nousresearch.com, then run hermes model",
  },
  antigravity: { name: "Antigravity CLI (agy)" },
};

let inflight: Promise<void> | null = null;

/**
 * A probe stats ~100 paths across the resolvers. The model picker and the
 * providers pane both probe on open, so without a TTL every open pays for it
 * again to learn what it already knows. Installing a CLI mid-session is rare,
 * and `force` covers it.
 */
const PROBE_TTL_MS = 30_000;

export function harnessUnavailableHint(id: HarnessId): string {
  const { name, install } = CLI[id];
  const how = install ? ` (\`${install}\`)` : "";
  return `${name} not found${how}. Install it, or restart MonoCode if it is already installed.`;
}

export function probeHarnessAvailability(
  options?: { force?: boolean },
): Promise<void> {
  if (inflight) return inflight;
  const lastProbe = harnessAvailabilityProbedAt();
  if (!options?.force && lastProbe > 0 && Date.now() - lastProbe < PROBE_TTL_MS) {
    return Promise.resolve();
  }
  // Sessions run the provider's own interactive CLI, so a provider counts as
  // available exactly when MonoCode can launch that CLI in a terminal.
  inflight = listNativeProviders()
    .catch(() => [])
    .then((providers) => {
      const next = Object.fromEntries(
        HARNESSES.map((id) => [id, false]),
      ) as HarnessAvailability;
      for (const provider of providers) {
        if (provider.installed) next[provider.id] = true;
      }
      setHarnessAvailability(next);
      emitHarnessAvailability();
    })
    .finally(() => {
      markHarnessAvailabilityProbed();
      inflight = null;
    });
  return inflight;
}
