import { expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import {
  coordinatorPromptKey,
  renderCoordinatorPrompt,
  threadHandoffs,
  threadSteps,
} from "./coordinator";

function call(command: string, status = "completed", detail?: unknown): Block {
  return {
    id: crypto.randomUUID(),
    role: "tool",
    text: command,
    tool: {
      title: command,
      status,
      preview: { kind: "shell", title: command },
      ...(detail ? { detail: JSON.stringify(detail) } : {}),
    },
  };
}

it("reads what the coordinator handed to threads, with their receipts", () => {
  const start = call(
    `monocode app sessions.start --json '{"prompt":"Build the junk voider","project":"/repo"}'`,
    "completed",
    { ok: true, result: { id: "app-c-1" } },
  );
  const send = call(
    `monocode app sessions.send --json '{"sessionId":"app-c-0","prompt":"Also void picked-up junk"}'`,
    "completed",
    { ok: true, result: { sessionId: "app-c-0", queued: true } },
  );
  const running = call(
    `monocode app sessions.start --json '{"prompt":"Redesign machines"}'`,
    "in_progress",
  );
  const failed = call(
    `monocode app sessions.start --json '{"prompt":"Nope"}'`,
    "failed",
    { ok: false, error: "bad" },
  );
  const read = call(
    `monocode app sessions.read --json '{"sessionId":"app-c-0"}'`,
  );
  expect(threadHandoffs([start, send, running, failed, read])).toEqual([
    { kind: "start", sessionId: "app-c-1", prompt: "Build the junk voider" },
    {
      kind: "send",
      sessionId: "app-c-0",
      prompt: "Also void picked-up junk",
      queued: true,
    },
    { kind: "start", prompt: "Redesign machines", pending: true },
    { kind: "start", prompt: "Nope", failed: true },
  ]);
});

it("follows the latest step list and the step in progress", () => {
  const blocks: Block[] = [
    {
      id: "a",
      role: "tasks",
      text: "",
      taskList: { items: [{ text: "Old", status: "pending" }] },
    },
    {
      id: "b",
      role: "tasks",
      text: "",
      taskList: {
        items: [
          { text: "Survey", status: "completed" },
          { text: "Render", status: "in_progress" },
          { text: "Dropped", status: "cancelled" },
          { text: "Share", status: "pending" },
        ],
      },
    },
  ];
  expect(threadSteps(blocks)).toMatchObject({
    done: 1,
    total: 3,
    current: "Render",
  });
  expect(threadSteps([])).toBeUndefined();
});

it("fills the coordinator prompt in, custom or default", () => {
  const look = {
    name: "robotica",
    projects: [{ name: "robotica", path: "/repo" }],
  };
  const custom = renderCoordinatorPrompt(
    "Coordinate {{project}} at {{path}}:\n{{folders}}",
    look,
  );
  expect(custom).toBe("Coordinate robotica at /repo:\n- robotica: /repo");
  const fallback = renderCoordinatorPrompt("   ", look);
  expect(fallback).toContain('the project "robotica"');
  expect(fallback).not.toContain("{{");
  expect(coordinatorPromptKey(undefined)).toBe("default");
  expect(coordinatorPromptKey("a")).not.toBe(coordinatorPromptKey("b"));
});
