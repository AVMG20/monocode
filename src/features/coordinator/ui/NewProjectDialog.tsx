import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FolderOpen } from "../../../shared/ui/icons";
import { Modal } from "../../../shared/ui/Modal";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "../../../shared/ui/SearchableSelect";
import { projectKey, projectName } from "../../../shared/lib/paths";

export type NewProjectInput = {
  name: string;
  path: string;
  instructions?: string;
};

type Props = {
  /** Folders the user has opened, to pick the project's folder from. */
  recents: readonly { path: string }[];
  /** Opens the native folder picker; resolves to a path or null. */
  onPickFolder: () => Promise<string | null>;
  onCreate: (input: NewProjectInput) => void;
  onCancel: () => void;
};

const fieldClass =
  "rounded-md border border-content/10 bg-content/5 px-2.5 font-sans text-[13px] text-content outline-none placeholder:text-content/30 focus:border-content/25";

/**
 * Starts a Claude Project: a name, the folder its threads work in, and
 * standing instructions the coordinator and every thread follow.
 */
export function NewProjectDialog({
  recents,
  onPickFolder,
  onCreate,
  onCancel,
}: Props) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [instructions, setInstructions] = useState("");
  const [picking, setPicking] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const trimmedName = name.trim();
  const ready = !!trimmedName && !!path;

  useEffect(() => {
    const frame = requestAnimationFrame(() => nameInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const options = useMemo((): SearchableSelectOption[] => {
    const seen = new Set<string>();
    const out: SearchableSelectOption[] = [];
    for (const entry of path ? [{ path }, ...recents] : recents) {
      if (!entry.path || entry.path === "~") continue;
      const key = projectKey(entry.path);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        value: entry.path,
        label: projectName(entry.path),
        keywords: entry.path,
      });
    }
    return out;
  }, [path, recents]);

  const submit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!ready) return;
    onCreate({
      name: trimmedName,
      path,
      ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
    });
  };

  const chooseFolder = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const picked = await onPickFolder();
      if (picked) setPath(picked);
    } finally {
      setPicking(false);
    }
  };

  return (
    <Modal
      title="New project"
      description="A coordinator that hands the work in one folder to threads."
      size="md"
      onClose={onCancel}
    >
      <form className="flex flex-col gap-4 p-4" onSubmit={submit}>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-content/70">Name</span>
          <input
            ref={nameInput}
            type="text"
            value={name}
            required
            maxLength={40}
            placeholder="Checkout redesign"
            aria-label="Project name"
            autoComplete="off"
            autoCorrect="off"
            onChange={(event) => setName(event.target.value)}
            className={`h-9 ${fieldClass}`}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-content/70">
            Folder
          </span>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SearchableSelect
                label="Project folder"
                value={path}
                options={options}
                onChange={setPath}
                placeholder="Choose a recent folder…"
                searchPlaceholder="Search folders…"
                emptyLabel="No matching folders"
              />
            </div>
            <SecondaryButton
              onClick={() => void chooseFolder()}
              disabled={picking}
            >
              <FolderOpen className="size-3.5" strokeWidth={1.75} />
              Choose folder…
            </SecondaryButton>
          </div>
          {path ? (
            <p
              title={path}
              className="truncate text-[11px] leading-4 text-content/45"
            >
              {path}
            </p>
          ) : null}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-content/70">
            Instructions{" "}
            <span className="font-normal text-content/40">(optional)</span>
          </span>
          <textarea
            value={instructions}
            rows={4}
            placeholder="Standing instructions for the coordinator and every thread"
            aria-label="Instructions"
            onChange={(event) => setInstructions(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                !(event.metaKey || event.ctrlKey) ||
                event.nativeEvent.isComposing
              )
                return;
              event.preventDefault();
              submit();
            }}
            className={`min-h-20 resize-y py-2 leading-snug ${fieldClass}`}
          />
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready}
            className="inline-flex items-center gap-1.5 rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40"
          >
            Create project
          </button>
        </div>
      </form>
    </Modal>
  );
}
