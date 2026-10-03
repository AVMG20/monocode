import { describe, expect, it } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { fitTerminal, terminalScrollbarWidth } from "./terminalLayout";

describe("terminalScrollbarWidth", () => {
  it("defaults to 14px when overview ruler width is unset", () => {
    expect(terminalScrollbarWidth(undefined)).toBe(14);
    expect(terminalScrollbarWidth({})).toBe(14);
  });

  it("honors an explicit overview ruler width", () => {
    expect(terminalScrollbarWidth({ width: 1 })).toBe(1);
    expect(terminalScrollbarWidth({ width: 0 })).toBe(0);
  });
});

/**
 * A Terminal stand-in whose cell size follows its spacing options, rounded
 * to device pixels the way xterm sizes cells.
 */
function fakeTerminal(charWidth = 7.8, charHeight = 15, dpr = 1) {
  const options: { letterSpacing?: number; lineHeight?: number } = {
    letterSpacing: 0,
    lineHeight: 1,
  };
  const term = {
    cols: 80,
    rows: 24,
    options,
    resize(cols: number, rows: number) {
      term.cols = cols;
      term.rows = rows;
    },
    _core: {
      _renderService: {
        dimensions: {
          css: {
            get cell() {
              return {
                width:
                  Math.floor(
                    charWidth * dpr +
                      Math.round((options.letterSpacing ?? 0) * dpr),
                  ) / dpr,
                height:
                  Math.floor(charHeight * dpr * (options.lineHeight ?? 1)) /
                  dpr,
              };
            },
          },
        },
      },
    },
  };
  return term;
}

function fakeHost(width: number, height: number) {
  return { clientWidth: width, clientHeight: height } as HTMLElement;
}

function gridHeight(term: ReturnType<typeof fakeTerminal>) {
  return term.rows * term._core._renderService.dimensions.css.cell.height;
}

describe("fitTerminal", () => {
  it("never lets a TUI's last row overflow the host", () => {
    const term = fakeTerminal();
    const asTerm = term as unknown as Terminal;
    for (const height of [1000, 707, 993, 412, 1000, 519]) {
      fitTerminal(asTerm, fakeHost(900, height), "tui");
      expect(gridHeight(term)).toBeLessThanOrEqual(height);
      expect(height - gridHeight(term)).toBeLessThan(15);
    }
  });

  it("keeps the last row and column inside the host on a 2x display", () => {
    const term = fakeTerminal(7.8, 15.5, 2);
    const asTerm = term as unknown as Terminal;
    const cell = () => term._core._renderService.dimensions.css.cell;
    for (const [width, height] of [
      [900, 1000],
      [901, 707.5],
      [1203, 993],
      [640, 412.5],
      [900, 1000],
    ]) {
      fitTerminal(asTerm, fakeHost(width, height), "tui");
      expect(gridHeight(term)).toBeLessThanOrEqual(height);
      expect(height - gridHeight(term)).toBeLessThan(cell().height);
      // Width minus the 1px TUI gutter.
      expect(term.cols * cell().width).toBeLessThanOrEqual(width - 1);
    }
  });

  it("re-counts rows at the unstretched size when the host shrinks", () => {
    const term = fakeTerminal();
    const asTerm = term as unknown as Terminal;
    fitTerminal(asTerm, fakeHost(900, 1007), "tui");
    fitTerminal(asTerm, fakeHost(900, 700), "tui");
    expect(term.rows).toBe(Math.floor(700 / 15));
    expect(gridHeight(term)).toBeLessThanOrEqual(700);
  });

  it("drops a stretch when a shell fit follows a TUI fit", () => {
    const term = fakeTerminal();
    const asTerm = term as unknown as Terminal;
    fitTerminal(asTerm, fakeHost(900, 1007), "tui");
    fitTerminal(asTerm, fakeHost(900, 1007), "shell");
    expect(term.options.lineHeight).toBe(1);
    expect(term.options.letterSpacing).toBe(0);
  });
});
