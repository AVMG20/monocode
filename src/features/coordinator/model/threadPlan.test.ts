import { expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import {
  activityCount,
  activityLog,
  currentTurn,
  hasOwnTaskList,
  parsePlan,
  planPrompt,
} from "./threadPlan";

const blocks: Block[] = [
  { id: "u0", role: "user", text: "Old task" },
  { id: "a0", role: "assistant", text: "Done before" },
  { id: "u1", role: "user", text: "Audit the commit", forwardedBy: "x" },
  {
    id: "t1",
    role: "tool",
    text: "",
    tool: { title: "git show bc3083ee", status: "completed" },
  },
  { id: "a1", role: "assistant", text: "Spawning an auditor" },
  { id: "c1", role: "user", text: "report", internal: true },
];

it("finds the turn in progress and what was done in it", () => {
  const turn = currentTurn(blocks);
  expect(turn?.user.id).toBe("u1");
  expect(hasOwnTaskList(turn!.work)).toBe(false);
  expect(activityCount(turn!.work)).toBe(2);
  expect(activityLog(turn!.work)).toEqual([
    "- ran: git show bc3083ee",
    "- said: Spawning an auditor",
  ]);
  const prompt = planPrompt({ task: "Audit the commit", activity: [] });
  expect(prompt).toContain("exactly one step is in_progress");
});

it("reads a checklist out of the model's reply", () => {
  expect(
    parsePlan(
      'Sure:\n{"steps":[{"text":"Read the commit","status":"completed"},{"text":"Audit","status":"in_progress"},{"text":"","status":"pending"},{"text":"Report","status":"weird"}]}',
    ),
  ).toEqual([
    { text: "Read the commit", status: "completed" },
    { text: "Audit", status: "in_progress" },
    { text: "Report", status: "pending" },
  ]);
  expect(parsePlan("no json")).toBeNull();
  expect(parsePlan('{"steps":[]}')).toBeNull();
});
