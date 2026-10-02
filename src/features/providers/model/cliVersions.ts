/** Oldest OpenCode CLI MonoCode supports. */
export const MINIMUM_OPENCODE_VERSION = "1.14.19";

/** First `x.y.z` in a CLI's `--version` output. */
export function parseOpenCodeVersion(output: string): string | null {
  const match = output.match(/\d+\.\d+\.\d+/);
  return match?.[0] ?? null;
}

export function compareSemver(left: string, right: string): number {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}
