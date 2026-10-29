import React, { useRef, useState } from "react";
import { validateTagName } from "../utils/validateTagName";

export interface EditableTagNameProps {
  name: string;
  onRename: (newName: string) => void | Promise<void>;
  onCancel: () => void;
  existingNames: string[];
}

export const EditableTagName: React.FC<EditableTagNameProps> = ({
  name,
  onRename,
  onCancel,
  existingNames,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const isSavingRef = useRef(false);
  // Prevents blur from triggering a second commit after keyboard commit/cancel.
  const suppressBlurCommitRef = useRef(false);

  const commit = async () => {
    if (isSavingRef.current) return;
    const validation = validateTagName(draft);
    if (!validation.valid) {
      setError(validation.reason ?? "Invalid tag name.");
      return;
    }
    const isDuplicate =
      draft.trim().toLowerCase() !== name.toLowerCase() &&
      existingNames.some((n) => n.toLowerCase() === draft.trim().toLowerCase());
    if (isDuplicate) {
      setError("A tag with this name already exists — use Merge instead.");
      return;
    }
    setEditing(false);
    setError(null);
    isSavingRef.current = true;
    try {
      await onRename(draft.trim());
    } catch {
      onCancel();
    } finally {
      isSavingRef.current = false;
    }
  };

  const cancel = () => {
    suppressBlurCommitRef.current = true;
    setEditing(false);
    setDraft(name);
    setError(null);
    onCancel();
    Promise.resolve().then(() => {
      suppressBlurCommitRef.current = false;
    });
  };
  const startEditing = () => {
    if (isSavingRef.current) return;
    suppressBlurCommitRef.current = false;
    setDraft(name);
    setError(null);
    setEditing(true);
  };

  if (editing) {
    return (
      <div>
        <input
          aria-label="Edit tag name"
          autoFocus
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              suppressBlurCommitRef.current = true;
              commit();
              Promise.resolve().then(() => {
                suppressBlurCommitRef.current = false;
              });
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={() => {
            if (suppressBlurCommitRef.current) {
              suppressBlurCommitRef.current = false;
              return;
            }
            commit();
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "2px 6px",
            fontSize: "13px",
            border: "1px solid var(--tm-border)",
            borderRadius: "2px",
            background: "var(--tm-surface)",
            color: "var(--text-primary-color, #1e1e1e)",
          }}
        />
        {error && (
          <div
            role="alert"
            style={{
              fontSize: "12px",
              color: "var(--status-error-foreground, #c4314b)",
              marginTop: "2px",
            }}
          >
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Rename tag ${name}`}
      title="Double-click, Enter, or F2 to rename"
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
        borderRadius: "2px",
        outline: focused
          ? "2px solid var(--communication-foreground, #0078d4)"
          : "none",
        outlineOffset: "2px",
      }}
    >
      {name}
      {hovered && (
        <span
          aria-hidden="true"
          title="Rename"
          style={{ fontSize: "11px", color: "var(--tm-text-secondary)" }}
        >
          ✎
        </span>
      )}
    </button>
  );
};
