import React from "react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  placeholder = "Search tags…",
}) => (
  <div
    style={{
      position: "relative",
      display: "flex",
      alignItems: "center",
      flex: "1 1 240px",
      minWidth: 0,
    }}
  >
    <input
      type="search"
      aria-label="Search tags"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        flex: 1,
        padding: "4px 28px 4px 8px",
        border: "1px solid var(--tm-border)",
        borderRadius: "2px",
        fontSize: "13px",
        color: "var(--text-primary-color, #1e1e1e)",
        background: "var(--tm-surface)",
      }}
    />
    {value && (
      <button
        type="button"
        aria-label="Clear search"
        onClick={() => onChange("")}
        style={{
          position: "absolute",
          right: "4px",
          width: "24px",
          height: "24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          background: "none",
          cursor: "pointer",
          color: "var(--tm-text-secondary)",
          fontSize: "16px",
          lineHeight: 1,
          padding: 0,
        }}
      >
        ×
      </button>
    )}
  </div>
);
