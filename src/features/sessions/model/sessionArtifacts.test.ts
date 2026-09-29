import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import { artifactIdFromSlug, sessionArtifacts } from "./sessionArtifacts";

const DOC =
  "https://claude.ai/code/artifact/ca87ef28-f987-48fe-9884-72e66abd8bb1";
const PAGE = "https://claude.ai/artifact/XNAZLwu2QQavJ2crQh1KW3";

function tool(
  id: string,
  title: string,
  detail: string,
  status = "completed",
): Block {
  return { id, role: "tool", text: title, tool: { title, detail, status } };
}

describe("sessionArtifacts", () => {
  it("collects docs from the Claude Docs connector and links from chat", () => {
    const blocks: Block[] = [
      { id: "u", role: "user", text: `${PAGE}?sk=abc\n\ncan you read this?` },
      tool(
        "t",
        "mcp__claude_ai_Claude_Docs__batch",
        `{"frame":{"url":"${DOC}"}}\n\nThe doc's viewer is at ${DOC}.`,
      ),
      { id: "a", role: "assistant", text: `Here it is: ${DOC}.` },
    ];
    expect(sessionArtifacts(blocks)).toEqual([
      {
        id: "XNAZLwu2QQavJ2crQh1KW3",
        url: `${PAGE}?sk=abc`,
        kind: "artifact",
        title: undefined,
      },
      {
        id: "ca87ef28-f987-48fe-9884-72e66abd8bb1",
        url: DOC,
        kind: "doc",
        title: undefined,
      },
    ]);
  });

  it("takes titles from browser tabs and attach tags", () => {
    const blocks: Block[] = [
      tool(
        "t",
        "mcp__claude-in-chrome__navigate",
        `tabId 1: "Tweakwise Cross-sell Clusters" ("${PAGE}?sk=abc")`,
      ),
      {
        id: "s",
        role: "system",
        text: `<artifact-attached url="${DOC}" title="Release &amp; notes" own/>`,
      },
    ];
    expect(sessionArtifacts(blocks).map((a) => a.title)).toEqual([
      "Tweakwise Cross-sell Clusters",
      "Release & notes",
    ]);
  });

  it("ignores failed tool calls and drops deleted artifacts", () => {
    const blocks: Block[] = [
      tool("f", "Artifact", `Artifact: {"url":"${PAGE}"}`, "failed"),
      { id: "a", role: "assistant", text: `Published: ${DOC}` },
      tool("d", "Artifact", `<artifact-deleted url="${DOC}"/>`),
    ];
    expect(sessionArtifacts(blocks)).toEqual([]);
  });

  it("reads the id past a title slug", () => {
    expect(artifactIdFromSlug("Release-notes-XNAZLwu2QQavJ2crQh1KW3")).toBe(
      "XNAZLwu2QQavJ2crQh1KW3",
    );
    expect(artifactIdFromSlug("ca87ef28-f987-48fe-9884-72e66abd8bb1")).toBe(
      "ca87ef28-f987-48fe-9884-72e66abd8bb1",
    );
  });
});
