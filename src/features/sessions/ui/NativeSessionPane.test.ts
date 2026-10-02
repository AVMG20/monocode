// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listNativeProviders: vi.fn(),
  attachNativeTerminal: vi.fn(),
  markFreshNativeLaunch: vi.fn(),
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
