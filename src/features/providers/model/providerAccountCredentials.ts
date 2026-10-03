import { invoke } from "@tauri-apps/api/core";
import type { ProviderAccountProvider } from "./providerAccounts";

/** Remove a named profile's native credentials before its UI metadata. */
export async function removeProviderAccountCredentials(
  provider: ProviderAccountProvider,
  accountId: string,
): Promise<void> {
  await invoke("provider_account_remove", { provider, accountId });
}

export type ProviderAccountFolder = {
  provider: ProviderAccountProvider;
  accountId: string;
  /** As chosen, e.g. `~/.claude-personal`. */
  path: string;
};

/** Folders the user chose for accounts, instead of MonoCode-managed ones. */
export async function listProviderAccountFolders(): Promise<
  ProviderAccountFolder[]
> {
  return invoke<ProviderAccountFolder[]>("provider_account_folders");
}

/**
 * Run an account with an existing config folder (for example the
 * `~/.claude-personal` a `claude-personal` alias uses), or pass `null` to go
 * back to the default folder.
 */
export async function setProviderAccountFolder(
  provider: ProviderAccountProvider,
  accountId: string,
  path: string | null,
): Promise<void> {
  await invoke("provider_account_set_folder", { provider, accountId, path });
}
