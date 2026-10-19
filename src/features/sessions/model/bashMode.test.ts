import { describe, expect, it } from "vitest";
import { formatBashRun, pendingBashContext } from "./bashMode";
import type { Block } from "./session";

const bash = (command: string, stdout: string, extra = {}): Block => ({
  id: command,
  role: "bash",
  text: command,
  bash: { command, stdout, stderr: "", status: "done", exitCode: 0, ...extra },
});

describe("bash mode context", () => {
  it("formats a run the way Claude Code records it", () => {
    expect(
      formatBashRun({
        command: "echo hi",
        stdout: "hi\n",
        stderr: "",
        status: "done",
      }),
    ).toBe(
      "<bash-input>echo hi</bash-input>\n<bash-stdout>hi</bash-stdout><bash-stderr></bash-stderr>",
    );
  });

  it("collects only runs after the last sent user message", () => {
    const blocks: Block[] = [
      bash("ls", "a"),
      { id: "u", role: "user", text: "hello" },
      bash("pwd", "/x"),
      { id: "a", role: "assistant", text: "reply" },
      bash("echo 2", "2"),
    ];
    expect(pendingBashContext(blocks)).toBe(
      "<bash-input>pwd</bash-input>\n<bash-stdout>/x</bash-stdout><bash-stderr></bash-stderr>\n\n" +
        "<bash-input>echo 2</bash-input>\n<bash-stdout>2</bash-stdout><bash-stderr></bash-stderr>\n\n",
    );
  });

  it("skips runs still in flight and returns nothing when none are pending", () => {
    expect(pendingBashContext([bash("sleep 9", "", { status: "running" })])).toBe("");
    expect(pendingBashContext([{ id: "u", role: "user", text: "x" }])).toBe("");
  });
});

describe("bash mode in the transcript", () => {
  it("opens its own turn and stays out of the folded activity", async () => {
    const { groupTurns, groupTurnItems } = await import("./transcriptActivity");
    const blocks: Block[] = [
      { id: "u", role: "user", text: "hi" },
      { id: "a", role: "assistant", text: "hello" },
      bash("ls", "a"),
    ];
    const turns = groupTurns(blocks);
    expect(turns.map((turn) => turn.map((block) => block.id))).toEqual([
      ["u", "a"],
      ["ls"],
    ]);
    expect(groupTurnItems(turns[1], { settled: true })).toEqual([
      { type: "block", block: turns[1][0] },
    ]);
  });
});

describe("bash mode output limit", () => {
  it("keeps the head and tail of output past the limit", async () => {
    const { truncateBashOutput, BASH_MAX_OUTPUT_CHARS } = await import("./bashMode");
    const long = `${"a".repeat(BASH_MAX_OUTPUT_CHARS)}${"b\n".repeat(10)}${"z".repeat(BASH_MAX_OUTPUT_CHARS)}`;
    const out = truncateBashOutput(long);
    expect(out.startsWith("a".repeat(BASH_MAX_OUTPUT_CHARS / 2))).toBe(true);
    expect(out.endsWith("z".repeat(BASH_MAX_OUTPUT_CHARS / 2))).toBe(true);
    expect(out).toMatch(/\[\d+ characters, \d+ lines truncated\]/);
    expect(out.length).toBeLessThan(BASH_MAX_OUTPUT_CHARS + 100);
    expect(truncateBashOutput("short")).toBe("short");
  });
});
