import { useState } from "react";
import type {
  TaskListItem,
  TaskListItemStatus,
} from "../../sessions/model/session";
import { Check, ChevronDown, ListEnd, Loader } from "../../../shared/ui/icons";
import type { ThreadSteps } from "../model/coordinator";

/**
 * The thread's plan, pinned under its header: how far along it is and the
 * step it is on, opening into the full list.
 */
export function ThreadStepsBar({
  steps,
  busy,
}: {
  steps: ThreadSteps;
  busy: boolean;
}) {
  const [open, setOpen] = useState(loadOpen);
  const finished = steps.total > 0 && steps.done >= steps.total;
  const ratio = steps.total ? steps.done / steps.total : 0;
  const label = finished
    ? "All steps done"
    : steps.current
      ? `Step ${Math.min(steps.done + 1, steps.total)} of ${steps.total}`
      : `${steps.done} of ${steps.total} steps`;
  return (
    <section
      aria-label="Thread steps"
      data-thread-steps=""
      className="shrink-0 border-b border-stroke"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() =>
          setOpen((value) => {
            saveOpen(!value);
            return !value;
          })
        }
        className="flex w-full min-w-0 items-center gap-2.5 px-4 py-2 text-left outline-none hover:bg-content/[0.03] focus-visible:bg-content/[0.04]"
      >
        <ListEnd
          aria-hidden
          className="size-3.5 shrink-0 text-content/45"
          strokeWidth={1.75}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-baseline gap-2 text-[12px]">
            <span className="shrink-0 font-medium text-content/80">
              {label}
            </span>
            {!finished && steps.current ? (
              <span className="min-w-0 truncate text-content/50">
                {steps.current}
              </span>
            ) : null}
          </span>
          <span
            aria-hidden
            className="h-1 w-full overflow-hidden rounded-full bg-content/8"
          >
            <span
              className={`block h-full rounded-full transition-[width] duration-500 ${
                finished
                  ? "bg-emerald-400/70"
                  : busy
                    ? "bg-accent"
                    : "bg-content/35"
              }`}
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </span>
        </span>
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-content/45">
          {steps.done}/{steps.total}
        </span>
        <ChevronDown
          aria-hidden
          className={`size-3.5 shrink-0 text-content/40 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <ol className="max-h-[40vh] overflow-y-auto px-4 pb-2.5 pt-0.5">
          {steps.items.map((item, index) => (
            <StepRow key={item.id ?? `${index}:${item.text}`} item={item} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

const OPEN_KEY = "monocode:thread-steps-open";

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // It opens again next time; harmless.
  }
}

function StepRow({ item }: { item: TaskListItem }) {
  return (
    <li className="flex min-w-0 items-start gap-2.5 py-1">
      <StepState status={item.status} />
      <span
        className={`min-w-0 flex-1 text-[12.5px] leading-[18px] ${
          item.status === "in_progress"
            ? "text-content"
            : item.status === "completed"
              ? "text-content/75"
              : item.status === "cancelled"
                ? "text-content/35 line-through decoration-content/25"
                : "text-content/50"
        }`}
      >
        {item.text}
      </span>
    </li>
  );
}

function StepState({ status }: { status: TaskListItemStatus }) {
  if (status === "completed")
    return (
      <span
        aria-label="Done"
        className="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-content/75 text-background-base"
      >
        <Check className="size-2.5" strokeWidth={3} />
      </span>
    );
  if (status === "in_progress")
    return (
      <span
        aria-label="In progress"
        className="mt-px grid size-4 shrink-0 place-items-center text-accent"
      >
        <Loader className="size-4 motion-safe:animate-spin" strokeWidth={2} />
      </span>
    );
  return (
    <span
      aria-label={status === "cancelled" ? "Dropped" : "To do"}
      className="mt-px size-4 shrink-0 rounded-full border border-content/25"
    />
  );
}
