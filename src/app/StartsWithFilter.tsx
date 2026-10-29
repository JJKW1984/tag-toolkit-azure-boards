import React, { useLayoutEffect, useMemo, useRef } from "react";
import { Dropdown } from "azure-devops-ui/Dropdown";
import { IListBoxItem } from "azure-devops-ui/ListBox";
import { DropdownSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { TagItem } from "../types";

interface StartsWithFilterProps {
  tags: TagItem[];
  activeFilter: string | null;
  onFilter: (letter: string | null) => void;
}

const ANY = "all";

const LETTERS = [
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  "#",
];

const letterOf = (name: string) => {
  const ch = name[0]?.toUpperCase();
  return ch && ch >= "A" && ch <= "Z" ? ch : "#";
};

const label = (id: string) => (id === ANY ? "Any letter" : id === "#" ? "# (numbers and symbols)" : id);

export const StartsWithFilter: React.FC<StartsWithFilterProps> = ({ tags, activeFilter, onFilter }) => {
  // Only letters that have tags, so every choice leads somewhere. The active letter stays listed
  // so the control always shows what is applied, even if the search has since emptied it.
  const items = useMemo<IListBoxItem[]>(() => {
    const available = new Set(tags.map((t) => letterOf(t.name)));
    if (activeFilter) available.add(activeFilter);
    return [ANY, ...LETTERS.filter((l) => available.has(l))].map((id) => ({ id, text: label(id) }));
  }, [tags, activeFilter]);

  const selection = useMemo(() => new DropdownSelection(), []);
  const dropdown = useRef<Dropdown>(null);
  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === (activeFilter ?? ANY)));

  // Layout effect, so the first paint already shows the applied filter instead of an empty box.
  useLayoutEffect(() => {
    selection.select(selectedIndex);
  }, [selection, selectedIndex, items]);

  return (
    <div className="tm-starts-with" data-testid="starts-with-filter">
      <Dropdown
        ref={dropdown}
        ariaLabel="Starts with"
        items={items}
        selection={selection}
        onSelect={(_event, item) => {
          onFilter(item.id === ANY ? null : item.id);
          // Enter on a list item leaves the list open behind the filtered table, even though a
          // click closes it, so a keyboard user would have to press Escape after every choice.
          // Collapsing in the same tick is overridden by the Dropdown's own post-select focus
          // handling, so wait for the next one.
          setTimeout(() => dropdown.current?.collapse(), 0);
        }}
        // The second argument is every item, not the selected ones, so read the choice by index.
        renderSelectedItems={(current, all) =>
          `Starts with: ${all[current.value[0]?.beginIndex ?? 0]?.text ?? label(ANY)}`
        }
      />
    </div>
  );
};
