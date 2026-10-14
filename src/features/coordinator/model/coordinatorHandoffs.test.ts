import { expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import { monoSessionCompletionMessage } from "../../monos/model/monoSessionCompletion";
import {
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

it("fills the project's details into the coordinator prompt", () => {
  const prompt = renderCoordinatorPrompt({
    name: "robotica",
    projects: [{ name: "robotica", path: "/repo" }],
  });
  expect(prompt).toContain('the project "robotica"');
  expect(prompt).toContain("- robotica: /repo");
  expect(prompt).toContain('"project":"/repo"');
  expect(prompt).not.toContain("{{");
});

it("reads the threads a completion report brings back", () => {
  const message = monoSessionCompletionMessage({
    requestId: "r1",
    sessionId: "app-c-7",
    project: "/repo",
    prompt: "Review the backlog",
    outcome: { status: "failed", text: "Broke" },
  });
  const report: Block = {
    id: "report",
    role: "user",
    text: message.text,
    internal: true,
    monoSessionCompletion: message.monoSessionCompletion,
  };
  expect(threadHandoffs([report])).toEqual([
    { kind: "report", sessionId: "app-c-7", prompt: "", outcome: "failed" },
  ]);
  const group: Block = {
    ...report,
    id: "group",
    text: `Notice\n\n${JSON.stringify({
      sessions: [
        { sessionId: "a", status: "completed" },
        { sessionId: "b", status: "cancelled" },
      ],
    })}`,
  };
  expect(threadHandoffs([group]).map((h) => [h.sessionId, h.outcome])).toEqual([
    ["a", "completed"],
    ["b", "cancelled"],
  ]);
});
