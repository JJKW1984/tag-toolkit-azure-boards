import React from "react";
import { Icon, IconSize } from "azure-devops-ui/Icon";

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
  <div className="tm-search">
    <input
      type="search"
      className="tm-search-input"
      aria-label="Search tags"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
    {value && (
      <button type="button" className="tm-search-clear" aria-label="Clear search" onClick={() => onChange("")}>
        <Icon iconName="Clear" size={IconSize.inherit} />
      </button>
    )}
  </div>
);
