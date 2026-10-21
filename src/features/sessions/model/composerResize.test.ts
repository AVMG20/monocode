import { describe, expect, it } from "vitest";
import { COMPOSER_MAX_HEIGHT, resizeComposer } from "./composerResize";

function field(scrollHeight: number, height = "") {
  return { style: { height }, scrollHeight };
}

describe("resizeComposer", () => {
  it("grows the field to fit the draft", () => {
    const el = field(88);
    resizeComposer(el);
    expect(el.style.height).toBe("88px");
  });

  it("stops growing at the max height", () => {
    const el = field(400);
    resizeComposer(el);
    expect(el.style.height).toBe(`${COMPOSER_MAX_HEIGHT}px`);
  });

  it("supports a taller field without changing the composer default", () => {
    const el = field(400);
    resizeComposer(el, Number.POSITIVE_INFINITY);
    expect(el.style.height).toBe("400px");
  });

  it.each([
    [88, 140],
    [140, 88],
    [160, 400],
  ])(
    "keeps the composer space while measuring from %i to %i",
    (height, nextHeight) => {
      const wrapper = { style: { minHeight: "20px" }, offsetHeight: height };
      const style = { height: `${height}px` };
      let measured = false;
      const el = {
        style,
        parentElement: wrapper,
        get scrollHeight() {
          if (style.height === "auto") {
            // Reading layout here must not briefly expand the transcript's
            // viewport and clamp its scroll position before the final resize.
            expect(wrapper.style.minHeight).toBe(`${height}px`);
            measured = true;
          }
          return nextHeight;
        },
      };
      resizeComposer(el);
      expect(measured).toBe(true);
      expect(style.height).toBe(
        `${Math.min(nextHeight, COMPOSER_MAX_HEIGHT)}px`,
      );
      expect(wrapper.style.minHeight).toBe("20px");
    },
  );

  it("leaves the height alone when the field has no layout box", () => {
    const wrapper = { style: { minHeight: "20px" }, offsetHeight: 0 };
    const el = { ...field(0, "88px"), parentElement: wrapper };
    resizeComposer(el);
    expect(el.style.height).toBe("88px");
    expect(wrapper.style.minHeight).toBe("20px");
  });
});

describe("resizeComposer while typing", () => {
  function typed(value: string, scrollHeight: number, height: string) {
    const style = { height };
    let collapsed = false;
    const el = {
      style,
      value,
      get scrollHeight() {
        if (style.height === "auto") collapsed = true;
        return scrollHeight;
      },
    };
    return { el, collapsed: () => collapsed };
  }

  it("grows without collapsing when text is added at the end", () => {
    const first = typed("hello", 22, "");
    resizeComposer(first.el);
    expect(first.el.style.height).toBe("22px");
    first.el.value = "hello world";
    Object.defineProperty(first.el, "scrollHeight", { get: () => 44 });
    resizeComposer(first.el);
    expect(first.el.style.height).toBe("44px");
  });

  it("collapses to remeasure when text is removed", () => {
    const field = typed("hello world", 44, "44px");
    resizeComposer(field.el);
    field.el.value = "hello";
    resizeComposer(field.el);
    expect(field.collapsed()).toBe(true);
  });

  it("skips the collapse when appended text still fits", () => {
    const field = typed("hello", 22, "22px");
    resizeComposer(field.el);
    const before = field.collapsed();
    field.el.value = "hello!";
    const style = field.el.style;
    let collapsed = false;
    Object.defineProperty(field.el, "scrollHeight", {
      get: () => {
        if (style.height === "auto") collapsed = true;
        return 22;
      },
    });
    resizeComposer(field.el);
    expect(before).toBe(true);
    expect(collapsed).toBe(false);
    expect(style.height).toBe("22px");
  });
});
