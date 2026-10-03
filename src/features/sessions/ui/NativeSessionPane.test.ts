// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listNativeProviders: vi.fn(),
  attachNativeTerminal: vi.fn(),
  markFreshNativeLaunch: vi.fn(),
  gitBranches: vi.fn(),
  gitCheckout: vi.fn(),
  createWorktree: vi.fn(),
  listWorktrees: vi.fn(),
}));

vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  gitBranches: mocks.gitBranches,
  gitCheckout: mocks.gitCheckout,
}));
vi.mock("../../source-control/model/worktrees", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../source-control/model/worktrees")
  >()),
  createWorktree: mocks.createWorktree,
  listWorktrees: mocks.listWorktrees,
}));

vi.mock("../../../platform/tauri/nativeSession", () => ({
  listNativeProviders: mocks.listNativeProviders,
}));
vi.mock("./nativeTerminals", () => ({
  attachNativeTerminal: mocks.attachNativeTerminal,
  disposeNativeTerminal: vi.fn(),
  focusNativeTerminal: vi.fn(),
  markFreshNativeLaunch: mocks.markFreshNativeLaunch,
}));

import { NativeSessionPane } from "./NativeSessionPane";
import { newSession, type Session } from "../model/session";
import {
  newProviderAccount,
  saveProviderAccount,
} from "../../providers/model/providerAccounts";

let container: HTMLDivElement;
let root: Root;

function mockLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockLocalStorage();
  mocks.listNativeProviders.mockReset();
  mocks.listNativeProviders.mockResolvedValue([
    { id: "claude", installed: true },
    { id: "codex", installed: false },
  ]);
  mocks.attachNativeTerminal.mockReset();
  mocks.attachNativeTerminal.mockReturnValue(() => undefined);
  mocks.markFreshNativeLaunch.mockReset();
  mocks.gitBranches.mockReset();
  mocks.gitBranches.mockRejectedValue(new Error("not a repository"));
  mocks.gitCheckout.mockReset();
  mocks.createWorktree.mockReset();
  mocks.listWorktrees.mockReset();
  mocks.listWorktrees.mockResolvedValue({ worktrees: [], defaultRoot: "/trees" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(session: Session, onPatch = vi.fn()) {
  await act(async () => {
    root.render(
      createElement(NativeSessionPane, {
        session,
        visible: true,
        focused: true,
        onFocus: vi.fn(),
        onPatch,
      }),
    );
  });
  return onPatch;
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent?.trim() === label,
  );
  if (!found) throw new Error(`No button "${label}"`);
  return found as HTMLButtonElement;
}

it("starts Claude Code with the chosen profile", async () => {
  const work = newProviderAccount("claude", "Work");
  saveProviderAccount(work);
  const session = { ...newSession("claude", "/repo"), title: "claude" };
  const onPatch = await render(session);

  expect(container.textContent).toContain("Profile");
  expect(button("Codex").disabled).toBe(true);
  await act(async () => button("Work").click());
  expect(onPatch).toHaveBeenCalledWith(session.id, {
    providerAccountId: work.id,
  });
  // The app applies the patch; the launcher then starts under that profile.
  await render({ ...session, providerAccountId: work.id }, onPatch);
  await act(async () => button("Start Claude Code").click());

  expect(mocks.markFreshNativeLaunch).toHaveBeenCalledWith(session.id);
  expect(onPatch).toHaveBeenCalledWith(session.id, {
    harness: "claude",
    providerAccountId: work.id,
    providerSessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
});

it("hides the profile picker when there is only one account", async () => {
  await render(newSession("claude", "/repo"));
  expect(container.textContent).not.toContain("Profile");
});

it("resumes a launched session in its terminal under its profile", async () => {
  const session = {
    ...newSession("claude", "/repo"),
    providerSessionId: "9b3c1f0e-0000-4000-8000-000000000001",
    providerAccountId: "account-work",
  };
  await render(session);
  expect(mocks.attachNativeTerminal).toHaveBeenCalledWith(
    session.id,
    expect.any(HTMLElement),
    {
      cwd: "/repo",
      provider: "claude",
      accountId: "account-work",
      conversationId: session.providerSessionId,
    },
    expect.objectContaining({ onState: expect.any(Function) }),
  );
});

it("explains that remote projects cannot host a terminal session", async () => {
  await render(newSession("claude", "remote://box/repo"));
  expect(container.textContent).toContain("remote project");
  expect(mocks.attachNativeTerminal).not.toHaveBeenCalled();
});

const REPO_BRANCHES = {
  current: "main",
  detached: false,
  branches: [
    { name: "main", current: true, remote: null },
    { name: "feature", current: false, remote: null },
  ],
};

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("starts on the checked-out branch of a git project by default", async () => {
  mocks.gitBranches.mockResolvedValue(REPO_BRANCHES);
  const session = newSession("claude", "/git-default");
  const onPatch = await render(session);
  await flush();

  expect(container.textContent).toContain("Workspace");
  expect(
    container.querySelector('[aria-label="Branch: main"]'),
  ).not.toBeNull();
  await act(async () => button("Start Claude Code").click());
  await flush();

  expect(mocks.gitCheckout).not.toHaveBeenCalled();
  expect(onPatch).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      worktreeCwd: undefined,
      branch: "main",
      providerSessionId: expect.any(String),
    }),
  );
});

it("creates a new worktree before starting the CLI in it", async () => {
  mocks.gitBranches.mockResolvedValue(REPO_BRANCHES);
  mocks.createWorktree.mockResolvedValue({
    path: "/trees/fix-login",
    branch: "fix-login",
    head: "abc",
    isMain: false,
    locked: false,
    prunable: false,
    missing: false,
    dirty: false,
    unpushed: 0,
    sessionIds: [],
  });
  const session = newSession("claude", "/git-new-tree");
  const onPatch = await render(session);
  await flush();

  await act(async () => button("New worktree").click());
  const name = container.querySelector<HTMLInputElement>(
    '[aria-label="New branch name"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      name,
      "fix-login",
    );
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Start Claude Code").click());
  await flush();

  expect(mocks.createWorktree).toHaveBeenCalledWith(
    "/git-new-tree",
    "fix-login",
    "main",
    false,
  );
  expect(onPatch).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      worktreeCwd: "/trees/fix-login",
      branch: "fix-login",
      providerSessionId: expect.any(String),
    }),
  );
});

it("explains a blocked checkout and does not start", async () => {
  mocks.gitBranches.mockResolvedValue(REPO_BRANCHES);
  mocks.gitCheckout.mockRejectedValue(
    "Your local changes would be overwritten by checkout",
  );
  const session = newSession("claude", "/git-blocked");
  const onPatch = await render(session);
  await flush();

  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Branch: main"]')!
      .click(),
  );
  const feature = [...document.body.querySelectorAll('[role="option"]')].find(
    (row) => row.textContent === "feature",
  ) as HTMLButtonElement;
  await act(async () => feature.click());
  await act(async () => button("Start Claude Code").click());
  await flush();

  expect(mocks.gitCheckout).toHaveBeenCalledWith("/git-blocked", "feature", null);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Commit or stash",
  );
  expect(mocks.markFreshNativeLaunch).not.toHaveBeenCalled();
  expect(onPatch).not.toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({ providerSessionId: expect.any(String) }),
  );
});

it("shows the live branch above a running session and saves it", async () => {
  mocks.gitBranches.mockResolvedValue({ ...REPO_BRANCHES, current: "feature" });
  const session = {
    ...newSession("claude", "/git-header"),
    providerSessionId: "9b3c1f0e-0000-4000-8000-000000000002",
    branch: "main",
  };
  const onPatch = await render(session);
  await flush();

  expect(container.textContent).toContain("feature");
  expect(onPatch).toHaveBeenCalledWith(session.id, { branch: "feature" });
});
