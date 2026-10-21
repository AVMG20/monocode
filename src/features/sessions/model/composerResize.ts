/** Matches the composer's `max-h-40`, so the field stops growing where it clips. */
export const COMPOSER_MAX_HEIGHT = 160;

type Resizable = {
  style: { height: string };
  scrollHeight: number;
  value?: string;
  parentElement?: {
    style: { minHeight: string };
    offsetHeight: number;
  } | null;
};

const measured = new WeakMap<HTMLTextAreaElement, string>();
const measuredValues = new WeakMap<object, string>();

/** Everything but the height that decides how tall the draft wraps. */
function measurementBasis(el: HTMLTextAreaElement): string {
  const style = getComputedStyle(el);
  return [
    el.value,
    el.clientWidth,
    style.font,
    style.lineHeight,
    style.letterSpacing,
    style.textIndent,
    style.padding,
  ].join("\0");
}

/** A warm tab already has the right height; don't collapse and reflow it twice. */
export function restoreComposerSize(el: HTMLTextAreaElement) {
  if (measured.get(el) === `${measurementBasis(el)}\0${el.style.height}`)
    return;
  resizeComposer(el);
}

/** A hidden tab stays mounted with no layout box, so it reports 0 here. */
export function resizeComposer(el: Resizable, maxHeight = COMPOSER_MAX_HEIGHT) {
  const scrollHeight = el.scrollHeight;
  if (scrollHeight === 0) return;
  const textarea =
    typeof HTMLTextAreaElement !== "undefined" &&
    el instanceof HTMLTextAreaElement
      ? el
      : null;
  // Read while layout is still clean; reading after the height changes
  // forces another full layout, which a streaming transcript makes slow.
  const basis = textarea ? measurementBasis(textarea) : "";
  const previous = measuredValues.get(el);
  const height = Number.parseFloat(el.style.height);
  if (el.value !== undefined) measuredValues.set(el, el.value);
  // Typing at the end only ever keeps or grows the height, which the
  // current scrollHeight already tells without collapsing the field.
  if (
    el.value !== undefined &&
    previous !== undefined &&
    el.value !== previous &&
    el.value.startsWith(previous) &&
    Number.isFinite(height)
  ) {
    if (scrollHeight > height)
      el.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
  } else {
    const wrapper = el.parentElement;
    const minHeight = wrapper?.style.minHeight ?? "";
    // Measuring at `auto` briefly collapses the composer. Keep its space
    // until the final height is ready so the browser cannot clamp the
    // transcript's scroll position while its viewport temporarily grows.
    if (wrapper) wrapper.style.minHeight = `${wrapper.offsetHeight}px`;
    try {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    } finally {
      if (wrapper) wrapper.style.minHeight = minHeight;
    }
  }
  if (textarea) measured.set(textarea, `${basis}\0${el.style.height}`);
}
