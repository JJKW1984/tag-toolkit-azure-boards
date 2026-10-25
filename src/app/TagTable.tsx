// src/app/TagTable.tsx
import React, { useMemo } from "react";
import {
  ColumnFillId,
  ITableColumn,
  SimpleTableCell,
  Table,
} from "azure-devops-ui/Table";
import { ObservableValue } from "azure-devops-ui/Core/Observable";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { TagItem } from "../types";
import { EditableTagName } from "./EditableTagName";

type TagTableBaseProps = {
  tags: TagItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (select: boolean) => void;
};

type TagTableProps =
  | (TagTableBaseProps & {
      onRename: (tagId: string, newName: string) => void | Promise<void>;
      existingNames: string[];
    })
  | (TagTableBaseProps & {
      onRename?: undefined;
      existingNames?: string[];
    });

// Column widths are stable ObservableValues — defined outside the component
// so they are not recreated on every render (prevents ADO Table column flicker).
const colWidthSelect = new ObservableValue(48);
const colWidthName = new ObservableValue(300);
const EMPTY_NAMES: string[] = [];

export const TagTable: React.FC<TagTableProps> = (props) => {
  const { tags, selectedIds, onToggle, onToggleAll, onRename } = props;
  const existingNames = onRename ? props.existingNames : EMPTY_NAMES;

  if (tags.length === 0) {
    return (
      <ZeroData
        primaryText="No tags found"
        secondaryText="This project has no work item tags yet."
        imageAltText=""
      />
    );
  }

  const allSelected = tags.length > 0 && tags.every((t) => selectedIds.has(t.id));
  const someSelected = tags.some((t) => selectedIds.has(t.id));

  const tableItems = new ArrayItemProvider<TagItem>(tags);

  // Column renderers that close over selectedIds/onToggle are memoized so the
  // Table does not reinitialize on every checkbox toggle.
  const columns: ITableColumn<TagItem>[] = useMemo(() => [
    {
      id: "select",
      name: "",
      renderCell: (_rowIndex, columnIndex, tableColumn, item) => (
        <SimpleTableCell
          columnIndex={columnIndex}
          tableColumn={tableColumn}
          key={`sel-${item.id}`}
        >
          <Checkbox
            checked={selectedIds.has(item.id)}
            onChange={(_e, checked) => onToggle(item.id)}
          />
        </SimpleTableCell>
      ),
      renderHeaderCell: (columnIndex, tableColumn) => (
        <SimpleTableCell
          columnIndex={columnIndex}
          tableColumn={tableColumn}
          key="sel-header"
        >
          <Checkbox
            triState={true}
            checked={someSelected && !allSelected ? undefined : allSelected}
            onChange={(_e, checked) => onToggleAll(checked ?? false)}
          />
        </SimpleTableCell>
      ),
      readonly: true,
      width: colWidthSelect,
    },
    {
      id: "name",
      name: "Tag",
      renderCell: (_rowIndex, columnIndex, tableColumn, item) => (
        <SimpleTableCell
          columnIndex={columnIndex}
          tableColumn={tableColumn}
          key={`name-${item.id}`}
        >
          <span data-testid="tag-row" data-tag-name={item.name}>
            {onRename ? (
              <EditableTagName
                name={item.name}
                onRename={(newName) => onRename(item.id, newName)}
                onCancel={() => {}}
                existingNames={existingNames}
              />
            ) : (
              item.name
            )}
          </span>
        </SimpleTableCell>
      ),
      readonly: true,
      width: colWidthName,
    },
    {
      id: ColumnFillId,
      name: "Work Items",
      renderCell: (_rowIndex, columnIndex, tableColumn, item) => (
        <SimpleTableCell
          columnIndex={columnIndex}
          tableColumn={tableColumn}
          key={`count-${item.id}`}
        >
          <span data-testid="tag-count" data-tag-name={item.name}>
            {item.count === undefined ? (
              <span style={{ color: "var(--palette-neutral-30, #aaa)" }}>—</span>
            ) : (
              String(item.count)
            )}
          </span>
        </SimpleTableCell>
      ),
      readonly: true,
      width: -1,
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [selectedIds, onToggle, onToggleAll, allSelected, someSelected, onRename, existingNames]);

  return (
    <Table<TagItem>
      ariaLabel="Work item tags"
      columns={columns}
      itemProvider={tableItems}
      role="grid"
    />
  );
};
