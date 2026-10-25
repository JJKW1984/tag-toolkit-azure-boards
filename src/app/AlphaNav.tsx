import React from "react";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { TagItem } from "../types";

interface AlphaNavProps {
  tags: TagItem[];
  activeFilter: string | null;
  onFilter: (letter: string | null) => void;
}

const LETTERS = [
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  "#",
];

export const AlphaNav: React.FC<AlphaNavProps> = ({ tags, activeFilter, onFilter }) => {
  const available = new Set(
    tags.map((t) => {
      const ch = t.name[0]?.toUpperCase();
      return ch && ch >= "A" && ch <= "Z" ? ch : "#";
    })
  );
  const availableLetters = LETTERS.filter((l) => available.has(l));

  return (
    <div data-testid="alpha-nav">
      <TabBar
        selectedTabId={activeFilter ?? "all"}
        onSelectedTabChanged={(id) => onFilter(id === "all" ? null : id)}
        tabSize={TabSize.Compact}
      >
        <Tab id="all" name="All" />
        {availableLetters.map((letter) => (
          <Tab key={letter} id={letter} name={letter} />
        ))}
      </TabBar>
    </div>
  );
};
