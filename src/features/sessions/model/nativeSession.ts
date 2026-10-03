import type { NativeProviderId } from "../../../platform/tauri/nativeSession";
import {
  providerAccountLabel,
  providerAccounts,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  HARNESS_LABEL,
  HARNESS_TITLE,
  canReplaceSessionTitle,
  formatSessionTitle,
  type HarnessId,
  type Session,
} from "./session";

/** Providers whose own interactive CLI MonoCode can host in a session tab. */
export const NATIVE_PROVIDERS: readonly NativeProviderId[] = [
  "claude",
  "codex",
  "opencode",
  "antigravity",
];

export function isNativeProvider(id: HarnessId): id is NativeProviderId {
  return (NATIVE_PROVIDERS as readonly string[]).includes(id);
}

/**
 * How a session card names the agent: the CLI, plus the profile when there
 * is more than one to choose from (e.g. "Claude Code · Work").
 */
export function nativeSessionLabel(
  harness: HarnessId,
  accountId: string | undefined,
): string {
  const title = HARNESS_TITLE[harness];
  if (!supportsProviderAccounts(harness)) return title;
  if (providerAccounts(harness).length < 2) return title;
  return `${title} · ${providerAccountLabel(harness, accountId)}`;
}

/** Session fields a native terminal pane may change. */
export type NativeSessionPatch = Partial<
  Pick<
    Session,
    | "harness"
    | "providerAccountId"
    | "providerSessionId"
    | "title"
    | "branch"
    | "worktreeCwd"
  >
>;

/** Titles the terminal set this run, so later updates may replace them. */
const terminalTitles = new Map<string, string>();

/**
 * Turn an OSC terminal title from the CLI (Claude prints e.g. "✳ Fix login
 * bug") into a session title, or null when it should not replace the
 * current one: it is empty, generic, or the user renamed the session.
 */
export function nativeTitleFromTerminal(
  raw: string,
  session: Pick<Session, "id" | "title" | "harness">,
): string | null {
  // Shells and some CLIs report the working directory or a command line.
  if (/^\s*(?:[~/]|[a-z]:\\)/i.test(raw)) return null;
  const cleaned = raw
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  const generic = new Set([
    HARNESS_LABEL[session.harness].toLowerCase(),
    HARNESS_TITLE[session.harness].toLowerCase(),
    "claude",
    "claude code",
    "codex",
    "opencode",
    "agy",
    "antigravity",
  ]);
  if (generic.has(lower)) return null;
  const max = 72;
  const short =
    cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
  const next = formatSessionTitle(session.harness, short);
  if (next === session.title) return null;
  const replaceable =
    canReplaceSessionTitle(session.title, session.harness, "") ||
    terminalTitles.get(session.id) === session.title;
  if (!replaceable) return null;
  terminalTitles.set(session.id, next);
  return next;
}
