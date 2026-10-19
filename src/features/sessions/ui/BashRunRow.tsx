import { useLayoutEffect, useRef } from "react";
import type { BashRun } from "../model/session";

/** A composer `!command` and its output, printed in place like a terminal. */
export function BashRunRow({ run }: { run: BashRun }) {
  const stdout = run.stdout.trimEnd();
  const stderr = run.stderr.trimEnd();
  const running = run.status === "running";
  const exit = run.timedOut
    ? "Command timed out"
    : run.status === "failed" && run.exitCode != null && run.exitCode !== 0
      ? `Exit code ${run.exitCode}`
      : null;

  const boxRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  // Live output tails like a terminal until the user scrolls up to read.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box && running && following.current) box.scrollTop = box.scrollHeight;
  }, [running, stdout, stderr]);

  return (
    <div data-bash-run className="px-4 py-1.5 font-mono text-[12.5px] leading-5">
      <div className="flex min-w-0 gap-2">
        <span className="shrink-0 text-pink-600 dark:text-pink-400">!</span>
        <span className="min-w-0 whitespace-pre-wrap break-words text-content/90">
          {run.command}
        </span>
      </div>
      <div className="mt-0.5 flex min-w-0 gap-2 text-content/60">
        <span aria-hidden className="shrink-0 select-none text-content/30">
          ⎿
        </span>
        <div
          ref={boxRef}
          onScroll={(event) => {
            const box = event.currentTarget;
            following.current =
              box.scrollHeight - box.scrollTop - box.clientHeight < 8;
          }}
          className="max-h-80 min-w-0 flex-1 overflow-auto"
        >
          {stdout ? (
            <pre className="whitespace-pre-wrap break-words">{stdout}</pre>
          ) : null}
          {stderr ? (
            <pre className="whitespace-pre-wrap break-words text-red-600 dark:text-red-400/90">
              {stderr}
            </pre>
          ) : null}
          {running ? (
            <span className="block text-content/45">Running…</span>
          ) : !stdout && !stderr ? (
            <span className="text-content/45">(No content)</span>
          ) : null}
          {exit ? (
            <span className="block text-red-600 dark:text-red-400/90">{exit}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
