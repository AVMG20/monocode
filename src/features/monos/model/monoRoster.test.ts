// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createCoordinatorProject,
  listMonos,
  monoLook,
  monoProjectsPhrase,
  removeMono,
  reorderMonos,
} from "./mono";
import { monoBackgroundKey, monoChatBackground } from "./monoBackground";
import { saveProjectChatBackgroundSettings } from "../../projects/model/projectChatBackground";

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

const project = (name: string) =>
  createCoordinatorProject({ name, path: `/code/${name}` });

it("gives each new Mono a mascot and color the others are not using", () => {
  const first = project("app");
  const second = project("site");
  expect(second.mascot).not.toBe(first.mascot);
  expect(second.color).not.toBe(first.color);
  expect(monoLook(first).name).toBe("app");
  expect(first.projects).toEqual(["/code/app"]);
});

it("keeps the rail's order and forgets a removed Mono", () => {
  const a = project("a");
  const b = project("b");
  const c = project("c");
  reorderMonos([c.id, a.id, b.id]);
  expect(listMonos().map((mono) => mono.id)).toEqual([c.id, a.id, b.id]);
  removeMono(a.id);
  expect(listMonos().map((mono) => mono.id)).toEqual([c.id, b.id]);
});

it("names its projects the way a sentence would", () => {
  const named = (name: string) => ({ path: `/code/${name}`, name });
  expect(monoProjectsPhrase([])).toBe("");
  expect(monoProjectsPhrase([named("app")])).toBe("app");
  expect(
    monoProjectsPhrase([named("app"), named("site"), named("api")]),
  ).toBe("app, site and api");
});

it("forgets its background along with the Mono", () => {
  const mono = project("app");
  saveProjectChatBackgroundSettings(monoBackgroundKey(mono.id), {
    path: "/bg/mono.png",
    emptyOpacity: 0.24,
    sessionOpacity: 0.24,
    scope: "all",
    effect: "gradient-blur",
  });
  expect(monoChatBackground(mono.id)?.path).toBe("/bg/mono.png");
  removeMono(mono.id);
  expect(monoChatBackground(mono.id)).toBeNull();
});
