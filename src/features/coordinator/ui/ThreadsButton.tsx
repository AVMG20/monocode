import { ListEnd } from "../../../shared/ui/icons";
import { TerminalSpinner } from "../../sessions/ui/TerminalSpinner";

/**
 * Opens the project's threads beside the coordinator's chat. It carries what
 * needs the user, and what is running, so the list need not stay open.
 */
export function ThreadsButton({
  open,
  waiting,
  busy,
  onClick,
}: {
  open: boolean;
  waiting: number;
  busy: number;
  onClick: () => void;
}) {
  const label = open ? "Hide threads" : "Show threads";
  const detail = [
    waiting ? `${waiting} waiting for you` : "",
    busy ? `${busy} busy` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      title={detail ? `${label} (${detail})` : label}
      aria-label={detail ? `${label}, ${detail}` : label}
      aria-pressed={open}
      data-tauri-drag-region="false"
      onClick={onClick}
      className={`flex h-6.5 items-center gap-1.5 rounded-md px-2 font-sans text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-accent/50 ${
        open
          ? "bg-content/10 text-content"
          : "text-content/60 hover:bg-content/8 hover:text-content"
      }`}
    >
      <ListEnd className="size-3.5" strokeWidth={1.75} />
      <span>Threads</span>
      {busy > 0 ? (
        <span className="flex items-center gap-1 rounded-full bg-accent/12 px-1.5 text-[10.5px] tabular-nums text-accent">
          <TerminalSpinner className="inline-block w-2.5 select-none text-center text-[10px] leading-none" />
          {busy}
        </span>
      ) : null}
      {waiting > 0 ? (
        <span className="grid min-w-4 place-items-center rounded-full bg-amber-400/90 px-1 text-[10.5px] font-semibold tabular-nums leading-4 text-black">
          {waiting}
        </span>
      ) : null}
    </button>
  );
}
