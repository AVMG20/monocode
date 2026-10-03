import type { Terminal } from "@xterm/xterm";

export type TerminalFitMode = "shell" | "tui";

const DEFAULT_SCROLLBAR_WIDTH = 14;
const MIN_TUI_SCROLLBAR_WIDTH = 1;

type CellSize = { width: number; height: number };

export function terminalScrollbarWidth(overviewRuler?: {
  width?: number;
}): number {
  const width = overviewRuler?.width;
  return width === undefined ? DEFAULT_SCROLLBAR_WIDTH : width;
}

function cellSize(term: Terminal): CellSize | null {
  const dims = (
    term as unknown as {
      _core?: {
        _renderService?: { dimensions?: { css?: { cell?: CellSize } } };
      };
    }
  )._core?._renderService?.dimensions?.css?.cell;
  if (!dims || dims.width < 1 || dims.height < 1) return null;
  return dims;
}

function availableSize(
  host: HTMLElement,
  mode: TerminalFitMode,
  term: Terminal,
): { width: number; height: number } | null {
  const gutter =
    mode === "tui"
      ? MIN_TUI_SCROLLBAR_WIDTH
      : terminalScrollbarWidth(term.options.overviewRuler);
  const width = host.clientWidth - gutter;
  const height = host.clientHeight;
  if (width < 8 || height < 8) return null;
  return { width, height };
}

/**
 * Spread the leftover fraction of a row over the grid's line height (TUI
 * mode) so it reaches the host's bottom, given the unstretched cell size.
 * Columns are not stretched: xterm rounds letter-spacing to whole device
 * pixels, so a sub-pixel share per column never lands. Cell heights round
 * too, so the result is checked and backed off if the grid overflows.
 */
function stretchGrid(
  term: Terminal,
  size: { width: number; height: number },
  base: CellSize,
): void {
  const lineHeight = size.height / term.rows / base.height;
  if (lineHeight <= 1.001) return;
  term.options.lineHeight = lineHeight;

  for (let pass = 0; pass < 4; pass++) {
    const cell = cellSize(term);
    if (!cell) return;
    const overH = term.rows * cell.height - size.height;
    if (overH <= 0) return;
    const over = (overH + 1) / term.rows / base.height;
    term.options.lineHeight = Math.max(
      1,
      (term.options.lineHeight ?? 1) - over,
    );
  }
  resetGridStretch(term);
}

export function resetGridStretch(term: Terminal): void {
  if (term.options.letterSpacing !== 0) term.options.letterSpacing = 0;
  if (term.options.lineHeight !== 1) term.options.lineHeight = 1;
}

export function fitTerminal(
  term: Terminal,
  host: HTMLElement,
  mode: TerminalFitMode,
): { cols: number; rows: number } | null {
  const size = availableSize(host, mode, term);
  if (!size) return null;

  // Count cells at the unstretched size. A stretch left from a larger host
  // would otherwise make too few, too-tall rows — and rounding the count up
  // would push the last row (a TUI's footer) below the host's bottom edge.
  resetGridStretch(term);
  const cell = cellSize(term);
  if (!cell) return null;
  const base = { ...cell };

  const cols = Math.max(2, Math.floor(size.width / cell.width));
  const rows = Math.max(1, Math.floor(size.height / cell.height));
  if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);

  // A TUI paints its whole grid, so stretch the rows over the leftover
  // fraction of a row instead of leaving a strip at the bottom.
  if (mode === "tui") stretchGrid(term, size, base);

  return { cols: term.cols, rows: term.rows };
}

export function applyTerminalChrome(
  term: Terminal,
  outer: HTMLElement,
  tui: boolean,
): void {
  outer.classList.toggle("monocode-terminal--alt-screen", tui);
  term.options.overviewRuler = tui ? { width: MIN_TUI_SCROLLBAR_WIDTH } : {};
}
