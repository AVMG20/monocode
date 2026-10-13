import { useRef, useState, useSyncExternalStore } from "react";
import { IconButton } from "../../../app/shell/TitleBar";
import { RotateCcw } from "../../../shared/ui/icons";
import {
  findMono,
  monosSnapshot,
  subscribeMonos,
  updateMono,
} from "../../monos/model/mono";
import { PageHeader } from "../../monos/ui/monoPanelParts";
import { MarkdownSourceEditor } from "../../sessions/ui/MarkdownSourceEditor";
import {
  COORDINATOR_PROMPT_PLACEHOLDERS,
  DEFAULT_COORDINATOR_PROMPT,
} from "../model/coordinator";

/** Stores a prompt, or drops it when it is the default again. */
function savePrompt(monoId: string, text: string): void {
  const custom =
    text.trim() && text.trim() !== DEFAULT_COORDINATOR_PROMPT.trim()
      ? text
      : undefined;
  updateMono(monoId, (mono) => {
    const next = { ...mono, coordinatorPrompt: custom };
    if (!custom) delete next.coordinatorPrompt;
    return next;
  });
}

/**
 * The coordinator's prompt as an editable text: how it answers, forwards and
 * starts threads. Saved when you leave the editor; the default comes back
 * with one click.
 */
export function CoordinatorPromptPage({
  monoId,
  onBack,
}: {
  monoId: string;
  onBack: () => void;
}) {
  useSyncExternalStore(subscribeMonos, monosSnapshot);
  const saved = findMono(monoId)?.coordinatorPrompt;
  const [draft, setDraft] = useState(saved ?? DEFAULT_COORDINATOR_PROMPT);
  const base = useRef(saved);
  // Changed elsewhere (another window, a reset) while the draft is clean.
  if (
    base.current !== saved &&
    draft === (base.current ?? DEFAULT_COORDINATOR_PROMPT)
  ) {
    base.current = saved;
    setDraft(saved ?? DEFAULT_COORDINATOR_PROMPT);
  }
  const custom = !!saved;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-coordinator-prompt>
      <PageHeader title="Coordinator prompt" onBack={onBack}>
        <span
          className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium ${
            custom
              ? "border-accent/30 bg-accent/10 text-accent"
              : "border-stroke text-content/45"
          }`}
        >
          {custom ? "Customized" : "Default"}
        </span>
        <IconButton
          label="Reset to default"
          disabled={!custom && draft === DEFAULT_COORDINATOR_PROMPT}
          onClick={() => {
            base.current = undefined;
            setDraft(DEFAULT_COORDINATOR_PROMPT);
            savePrompt(monoId, "");
          }}
        >
          <RotateCcw className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      </PageHeader>
      <p className="shrink-0 border-b border-stroke px-4 py-2.5 text-[11.5px] leading-relaxed text-content/50">
        How the coordinator decides to answer, forward to a thread or start one.
        It gets this at the start of its conversation and again whenever it
        changes.{" "}
        {COORDINATOR_PROMPT_PLACEHOLDERS.map((name, index) => (
          <span key={name}>
            <code className="rounded bg-content/8 px-1 font-mono text-[10.5px] text-content/70">
              {name}
            </code>
            {index < COORDINATOR_PROMPT_PLACEHOLDERS.length - 2
              ? ", "
              : index === COORDINATOR_PROMPT_PLACEHOLDERS.length - 2
                ? " and "
                : ""}
          </span>
        ))}{" "}
        are filled in with the project's name, folders and main folder.
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        <MarkdownSourceEditor
          lineNumbers={false}
          className="min-h-full"
          label="Coordinator prompt"
          value={draft}
          placeholder="How the coordinator should work"
          onChange={setDraft}
          onBlur={() => {
            if (draft === (base.current ?? DEFAULT_COORDINATOR_PROMPT)) return;
            base.current = draft.trim() ? draft : undefined;
            savePrompt(monoId, draft);
          }}
        />
      </div>
    </div>
  );
}
