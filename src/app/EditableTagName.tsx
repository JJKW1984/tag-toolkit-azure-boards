import React, { useEffect, useRef, useState } from "react";
import { Icon, IconSize } from "azure-devops-ui/Icon";
import { validateTagName } from "../utils/validateTagName";

export interface EditableTagNameProps {
  name: string;
  /** Resolves when the rename is done. Reject with a user-readable message to keep the editor open. */
  onRename: (newName: string) => void | Promise<void>;
  onCancel: () => void;
  existingNames: string[];
}

let nextInstanceId = 1;

/** After a rename the list re-sorts, so the row may have moved: find the name's trigger by the tag it shows. */
const triggerFor = (tagName: string): HTMLElement | undefined =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-rename-trigger]")).find(
    (el) => el.dataset.renameTrigger === tagName
  );

const allTriggers = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>("[data-rename-trigger]"));

/** How many names come before `el` in the list: the row's place, for when the rename moves it out of view. */
const placeInList = (el: HTMLElement): number =>
  allTriggers().filter((t) => el.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING).length;

export const EditableTagName: React.FC<EditableTagNameProps> = ({
  name,
  onRename,
  onCancel,
  existingNames,
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const instanceId = useRef(`tm-rename-${nextInstanceId++}`).current;
  const hintId = `${instanceId}-hint`;
  const errorId = `${instanceId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Refs as well as state: the blur handler and the async commit need the current value, not the
  // one from the render that created them.
  const editingRef = useRef(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Closing the editor unmounts the focused input, which sends focus to <body>. Put it back on the name
  // so keyboard and screen-reader users keep their place in the list.
  useEffect(() => {
    if (!editing && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [editing]);

  const stopEditing = (restoreFocus: boolean) => {
    editingRef.current = false;
    restoreFocusRef.current = restoreFocus;
    setEditing(false);
    setDraft(name);
    setError(null);
  };

  // `restoreFocus` is false when the user left the field on their own: they already chose where focus goes.
  const cancel = (restoreFocus = true) => {
    stopEditing(restoreFocus);
    onCancel();
  };

  const commit = async () => {
    if (savingRef.current) return;
    const next = draft.trim();
    // Nothing to rename. Skip the request, which would rewrite every work item to the same value.
    if (next === name) {
      cancel();
      return;
    }
    const validation = validateTagName(next);
    if (!validation.valid) {
      setError(validation.reason ?? "Invalid tag name.");
      return;
    }
    const isDuplicate =
      next.toLowerCase() !== name.toLowerCase() &&
      existingNames.some((n) => n.toLowerCase() === next.toLowerCase());
    if (isDuplicate) {
      setError("A tag with this name already exists — use Merge instead.");
      return;
    }

    // The editor stays open and locked while the request runs, so there is always something on screen
    // saying a rename is happening, and a failure has the draft to come back to.
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const place = inputRef.current ? placeInList(inputRef.current) : 0;
    try {
      await onRename(next);
      if (mountedRef.current) {
        editingRef.current = false;
        setEditing(false);
      }
      // The list re-sorts on success, so the row (and this component) may have moved or been replaced.
      // Follow the tag to its new row. If it left this page there is no such row, so stay at the same
      // place in the list, on whichever tag moved up into it, rather than dropping focus on the page.
      const refocus = (): boolean => {
        const target = triggerFor(next) ?? (mountedRef.current ? triggerRef.current : null);
        if (target) {
          target.focus();
          return true;
        }
        return false;
      };
      if (!refocus()) {
        window.requestAnimationFrame(() => {
          if (refocus()) return;
          const triggers = allTriggers();
          triggers[Math.min(place, triggers.length - 1)]?.focus();
        });
      }
    } catch (e) {
      if (mountedRef.current) {
        const reason = e instanceof Error ? e.message : String(e);
        setError(`Couldn't rename “${name}”: ${reason}`);
        inputRef.current?.focus();
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const startEditing = () => {
    if (savingRef.current) return;
    editingRef.current = true;
    setDraft(name);
    setError(null);
    setEditing(true);
  };

  if (editing) {
    const describedBy = [saving ? undefined : hintId, error ? errorId : undefined].filter(Boolean).join(" ");
    return (
      <div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px" }}>
          <input
            ref={inputRef}
            className="tm-rename-input"
            aria-label="Edit tag name"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy || undefined}
            aria-busy={saving || undefined}
            // Right-to-left names are typed in their own direction.
            dir="auto"
            readOnly={saving}
            autoFocus
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              // Enter or Escape while an input method is composing belongs to the composition.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                if (!savingRef.current) cancel();
              }
            }}
            // Leaving the field abandons the edit. A rename rewrites every work item in the organization
            // and cannot be undone, so it takes Enter, never a stray click elsewhere.
            onBlur={() => {
              if (!editingRef.current || savingRef.current) return;
              cancel(false);
            }}
            style={{
              flex: "1 1 auto",
              // The name column is only ~126px wide on a phone, and a native input is ~190px wide unless
              // told otherwise, which makes the cell, the error and the hint all overflow it. Viewport
              // units because the column's width is not known yet when the cell is sized.
              width: "clamp(4rem, calc(100vw - 24rem), 24rem)",
              minWidth: 0,
              boxSizing: "border-box",
              padding: "2px 6px",
              fontSize: "13px",
              border: "1px solid var(--tm-border)",
              borderRadius: "2px",
              background: "var(--tm-surface)",
              color: "var(--tm-text-primary)",
            }}
          />
          {saving ? (
            <span role="status" className="tm-edit-hint">
              Renaming…
            </span>
          ) : (
            <span id={hintId} className="tm-edit-hint">
              Press Enter to rename, Esc to cancel.
            </span>
          )}
        </div>
        {error && (
          <div id={errorId} role="alert" className="tm-field-error">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      ref={triggerRef}
      type="button"
      data-rename-trigger={name}
      aria-label={`Rename tag ${name}`}
      // The full name too, since a long one is shortened with an ellipsis.
      title={`${name}\nDouble-click, Enter, or F2 to rename`}
      onDoubleClick={startEditing}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "F2" || e.key === " ") {
          e.preventDefault();
          startEditing();
        }
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        cursor: "pointer",
        border: "none",
        background: "transparent",
        color: "inherit",
        font: "inherit",
        padding: 0,
        minWidth: 0,
        maxWidth: "100%",
        borderRadius: "2px",
        outline: focused ? "2px solid var(--tm-focus)" : "none",
        outlineOffset: "2px",
      }}
    >
      <span className="tm-tag-name">{name}</span>
      {(hovered || focused) && (
        <span
          aria-hidden="true"
          title="Rename"
          style={{ display: "inline-flex", flex: "none", fontSize: "12px", color: "var(--tm-text-secondary)" }}
        >
          <Icon iconName="Edit" size={IconSize.inherit} />
        </span>
      )}
    </button>
  );
};
