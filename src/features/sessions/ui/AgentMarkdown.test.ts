// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("AgentMarkdown text direction", () => {
  it("detects direction independently for RTL and LTR blocks", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: [
          "# راهنمای تنظیمات",
          "",
          "این متن فارسی است.",
          "",
          "1. مرحله اول",
          "2. مرحله دوم",
          "",
          "English remains left to right.",
        ].join("\n"),
      }),
    );

    expect(markup).toMatch(/dir="rtl"[^>]*><h1/);
    expect(markup).toMatch(/dir="rtl"[^>]*><p/);
    expect(markup).toMatch(/dir="rtl"[^>]*><ol/);
    expect(markup).toMatch(/dir="ltr"[^>]*><p/);
  });

  it("isolates links and inline code inside RTL prose", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "مسیر `templates/admin/settings.html` و [پیوند](https://example.com) را بررسی کنید.",
      }),
    );

    expect(markup).toContain('<code dir="ltr"');
    expect(markup).toContain('dir="auto"');
  });

  it("keeps fenced code blocks LTR when their content is Arabic", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```txt\nمرحبا بالعالم\n```",
      }),
    );

    expect(markup).toContain('class="markdown-code-shell" dir="ltr"');
  });
});

describe("AgentMarkdown inline code", () => {
  it("lets a long inline code span grow instead of clipping to a fixed height", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "1. `Before I refactor the transcript rendering, summarize how turns are grouped, in five bullets.`",
      }),
    );

    const match = markup.match(/<code dir="ltr" class="([^"]*)"/);
    expect(match).not.toBeNull();
    const classes = match![1].split(/\s+/);
    expect(classes).toContain("inline-flex");
    expect(classes).toContain("min-h-6");
    expect(classes).toContain("max-w-full");
    expect(classes).toContain("[overflow-wrap:anywhere]");
    expect(classes).not.toContain("h-6");
  });
});

describe("AgentMarkdown code fence highlighting", () => {
  it("falls back to JS highlighting for a fence tagged text", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```text\nconst x = 1;\n```",
      }),
    );

    expect(markup).toContain('data-language="js"');
    expect(markup).not.toContain('data-language="text"');
  });

  it("falls back to JS highlighting for an untagged fence", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```\nconst x = 1;\n```",
      }),
    );

    expect(markup).toContain('data-language="js"');
  });

  it("leaves an explicit real language alone", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```python\nx = 1\n```",
      }),
    );

    expect(markup).toContain('data-language="python"');
  });

  it("keeps a text fence labeled text despite the JS highlighting fallback", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```text\nconst x = 1;\n```",
      }),
    );

    expect(markup).toContain('data-language="js"');
    expect(markup).toMatch(
      /class="markdown-code-fallback-label"[^>]*>text<\/span>/,
    );
  });

  it("leaves an untagged fence without a visible language label", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```\nconst x = 1;\n```",
      }),
    );

    expect(markup).toMatch(
      /class="markdown-code-fallback-label"[^>]*><\/span>/,
    );
  });

  it("keeps the plaintext and txt fallbacks labeled with their own fence language", () => {
    const plaintextMarkup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```plaintext\nconst x = 1;\n```",
      }),
    );
    expect(plaintextMarkup).toContain('data-language="js"');
    expect(plaintextMarkup).toMatch(
      /class="markdown-code-fallback-label"[^>]*>plaintext<\/span>/,
    );

    const txtMarkup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```txt\nconst x = 1;\n```",
      }),
    );
    expect(txtMarkup).toContain('data-language="js"');
    expect(txtMarkup).toMatch(
      /class="markdown-code-fallback-label"[^>]*>txt<\/span>/,
    );
  });

  it("does not add a fallback label for a real language", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```python\nx = 1\n```",
      }),
    );

    expect(markup).not.toContain("markdown-code-fallback-label");
  });
});

describe("AgentMarkdown note images", () => {
  it("keeps app-owned note image references for the async image resolver", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "![Diagram](/note-assets/note-1/123-diagram.png)",
      }),
    );

    expect(markup).toContain(
      'data-note-image="/note-assets/note-1/123-diagram.png"',
    );
    expect(markup).toContain('alt="Diagram"');
  });
});

describe("AgentMarkdown artifact previews", () => {
  it("offers an isolated preview for completed HTML and SVG fences", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() =>
      root.render(
        createElement(AgentMarkdown, {
          text: '```html\n<h1>Hello</h1><script>alert(1)</script>\n```\n\n```svg\n<svg><circle r="5"/></svg>\n```',
        }),
      ),
    );

    const buttons = container.querySelectorAll<HTMLButtonElement>(
      ".markdown-artifact-toggle",
    );
    expect(buttons).toHaveLength(2);
    expect(container.querySelector("iframe")).toBeNull();
    act(() => buttons[0].click());

    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame?.getAttribute("srcdoc")).toContain("default-src 'none'");
    expect(frame?.getAttribute("srcdoc")).toContain("<h1>Hello</h1>");
    act(() => root.unmount());
  });

  it("does not preview unrelated code", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```javascript\nalert(1)\n```",
      }),
    );
    expect(markup).not.toContain("markdown-artifact-toggle");
  });
});
