import { invoke } from "@tauri-apps/api/core";
import type { ProviderAccountProvider } from "./providerAccounts";

/** Remove a named profile's native credentials before its UI metadata. */
export async function removeProviderAccountCredentials(
  provider: ProviderAccountProvider,
  accountId: string,
): Promise<void> {
  await invoke("provider_account_remove", { provider, accountId });
}

/** A Claude profile on an API token instead of a claude.ai sign-in. */
export type ClaudeAccountEndpoint = {
  /** `null` for Anthropic's own API. */
  baseUrl: string | null;
  /** Where the gateway reports usage in Claude's layout, if it does. */
  usageUrl: string | null;
};

/** The endpoint a Claude profile uses, or `null` for a claude.ai sign-in. */
export async function claudeAccountEndpoint(
  accountId: string,
): Promise<ClaudeAccountEndpoint | null> {
  return invoke<ClaudeAccountEndpoint | null>("provider_account_endpoint", {
    accountId,
  });
}

/**
 * Point a Claude profile at an API endpoint with a token instead of a
 * claude.ai sign-in. An empty `baseUrl` means Anthropic's own API, an empty
 * `token` keeps the profile's current one, and an empty `usageUrl` means the
 * gateway reports no usage.
 */
export async function setClaudeAccountEndpoint(
  accountId: string,
  endpoint: { baseUrl: string; token: string; usageUrl: string },
): Promise<void> {
  await invoke("provider_account_set_endpoint", { accountId, ...endpoint });
}

/** Take a Claude profile off its API endpoint, back to a claude.ai sign-in. */
export async function clearClaudeAccountEndpoint(
  accountId: string,
): Promise<void> {
  await invoke("provider_account_clear_endpoint", { accountId });
}
