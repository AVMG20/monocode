import { expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import {
  renderCoordinatorPrompt,
  threadSteps,
} from "./coordinator";

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
