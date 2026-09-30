import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import {
  artifactIdFromSlug,
  sessionArtifacts,
  titleFromFileName,
  titleFromPage,
} from "./sessionArtifacts";

const DOC =
  "https://claude.ai/code/artifact/ca87ef28-f987-48fe-9884-72e66abd8bb1";
const PAGE = "https://claude.ai/artifact/XNAZLwu2QQavJ2crQh1KW3";
const DOCS_BATCH = "mcp__claude_ai_Claude_Docs__batch";

function tool(
  id: string,
  kind: string,
  detail: string,
  extra: { status?: string; artifactTitle?: string } = {},
): Block {
  return {
    id,
    role: "tool",
    text: kind,
    tool: { title: kind, kind, detail, status: "completed", ...extra },
  };
}

const published = (url: string, version = 1) =>
  `Published /tmp/scratchpad/ticket-mail-flow.html at ${url} (Version ${version}, version id 1790754301-1553) Icon: "mail".\n\nLive subscription: none.`;

describe("sessionArtifacts", () => {
  it("collects docs from the Claude Docs connector and links the user sent", () => {
    const blocks: Block[] = [
      { id: "u", role: "user", text: `${PAGE}?sk=abc\n\ncan you read this?` },
      tool(
        "t",
        DOCS_BATCH,
        `{"created":{"bound":true},"frame":{"slug":"x","url":"${DOC}"}}\n\nThe doc's viewer is at ${DOC}.`,
        { artifactTitle: "Release notes" },
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
        title: "Release notes",
      },
    ]);
  });

  it("ignores links that only turn up in other output", () => {
    const blocks: Block[] = [
      tool("r", "read", `const PAGE = "${PAGE}";`),
      tool("b", "execute", `USE {"url": "${DOC}"}`),
      tool(
        "l",
        "Artifact",
        `2 published artifacts (most recent first):\n- (mine) Clusters — ${PAGE} — updated 2026-09-24`,
      ),
      tool(
        "g",
        "mcp__claude_ai_Claude_Docs__guide",
        `"frame":{"url":"${DOC}"}`,
      ),
      { id: "a", role: "assistant", text: `See ${PAGE} and ${DOC}.` },
    ];
    expect(sessionArtifacts(blocks)).toEqual([]);
  });

  it("names links from browser tabs and attach tags", () => {
    const blocks: Block[] = [
      tool("p", "Artifact", published(PAGE)),
      tool(
        "t",
        "mcp__claude-in-chrome__navigate",
        `tabId 1: "Tweakwise Cross-sell Clusters" ("${PAGE}?sk=abc")\ntabId 2: "Other" ("https://claude.ai/artifact/AAAAAAAAAAAAAAAAAAAAAA")`,
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
      tool("f", "Artifact", published(DOC), { status: "failed" }),
      tool("o", "Artifact", `Opened the Artifact at ${DOC} for the user.`),
      tool("d", "Artifact", `<artifact-deleted url="${DOC}"/>`),
    ];
    expect(sessionArtifacts(blocks)).toEqual([]);
  });

  it("keeps the file the Artifact tool last published to a link", () => {
    const blocks: Block[] = [
      tool("p1", "Artifact", published(PAGE, 1)),
      tool("p2", "Artifact", published(PAGE, 2), { artifactTitle: "Flow" }),
    ];
    expect(sessionArtifacts(blocks)).toEqual([
      {
        id: "XNAZLwu2QQavJ2crQh1KW3",
        url: PAGE,
        kind: "artifact",
        title: undefined,
        source: {
          path: "/tmp/scratchpad/ticket-mail-flow.html",
          version: "2",
          title: "Flow",
        },
      },
    ]);
  });

  it("names a published page by its title or file name", () => {
    expect(
      titleFromPage("<head><title>\n  Ticket Mail &amp; Flow\n</title></head>"),
    ).toBe("Ticket Mail & Flow");
    expect(titleFromPage("# Release notes\n\nBody")).toBe("Release notes");
    expect(titleFromPage("<p>no title</p>")).toBeUndefined();
    expect(titleFromFileName("/tmp/scratchpad/ticket-mail-flow.html")).toBe(
      "Ticket Mail Flow",
    );
    expect(titleFromFileName("C:\\tmp\\index.html")).toBeUndefined();
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
