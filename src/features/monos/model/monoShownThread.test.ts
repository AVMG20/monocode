// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { loadShownThread, saveShownThread } from "./mono";

afterEach(() => localStorage.clear());

it("remembers the thread each Mono showed last", () => {
  saveShownThread("a", "thread-1");
  saveShownThread("b", "thread-2");
  expect(loadShownThread("a")).toBe("thread-1");
  expect(loadShownThread("b")).toBe("thread-2");
});

it("forgets a Mono's thread when it goes back to its list", () => {
  saveShownThread("a", "thread-1");
  saveShownThread("a", null);
  expect(loadShownThread("a")).toBeNull();
});

it("ignores unreadable storage", () => {
  localStorage.setItem("monocode:mono-shown-thread", "not json");
  expect(loadShownThread("a")).toBeNull();
});
