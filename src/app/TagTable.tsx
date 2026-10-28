// src/app/TagTable.tsx
import React, { useMemo, useRef } from "react";
import {
  ColumnJustification,
  ColumnSorting,
  ITableColumn,
  SimpleTableCell,
  SortOrder,
  Table,
} from "azure-devops-ui/Table";
import { ObservableValue } from "azure-devops-ui/Core/Observable";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { ZeroData, ZeroDataActionType } from "azure-devops-ui/ZeroData";
import { TagItem } from "../types";
import { EditableTagName } from "./EditableTagName";
import { SortKey, SortState } from "../utils/sortTags";

type TagTableBaseProps = {
  tags: TagItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (select: boolean) => void;
  /** True when a search or letter filter produced this list, so an empty list is "no matches", not "no tags". */
  isFiltered?: boolean;
  onClearFilters?: () => void;
  /** The active sort. Columns are only sortable when `onSort` is also given. */
  sort?: SortState;
  onSort?: (sort: SortState) => void;
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
const colWidthCount = new ObservableValue(190);
const EMPTY_NAMES: string[] = [];

export const TagTable: React.FC<TagTableProps> = (props) => {
  const { tags, selectedIds, onToggle, onToggleAll, onRename, isFiltered, onClearFilters, sort, onSort } = props;
  const existingNames = onRename ? props.existingNames : EMPTY_NAMES;

  const allSelected = tags.length > 0 && tags.every((t) => selectedIds.has(t.id));
  const someSelected = tags.some((t) => selectedIds.has(t.id));

  // A stable provider keeps the Table from resetting focus and scroll on every render.
  const tableItems = useMemo(() => new ArrayItemProvider<TagItem>(tags), [tags]);

  // A column is sortable when it has sortProps; only the active one carries a sortOrder.
  const sortProps = (key: SortKey) =>
    onSort
      ? {
          sortProps: {
            sortOrder:
              sort?.key === key
                ? sort.direction === "asc"
                  ? SortOrder.ascending
                  : SortOrder.descending
                : undefined,
          },
        }
      : {};

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
            ariaLabel={`Select ${item.name}`}
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
            ariaLabel="Select all tags on this page"
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
      // Flexes with the card, so the fixed count column never gets pushed out of view.
      width: -1,
      ...sortProps("name"),
    },
    {
      id: "count",
      name: "Work items (org-wide)",
      justification: ColumnJustification.Right,
      renderCell: (_rowIndex, columnIndex, tableColumn, item) => (
        <SimpleTableCell
          columnIndex={columnIndex}
          tableColumn={tableColumn}
          // The column's justification only moves the header; the cell content has to be pushed over too.
          contentClassName="justify-end"
          key={`count-${item.id}`}
        >
          <span data-testid="tag-count" data-tag-name={item.name}>
            {item.count === undefined ? (
              <span className="tm-count-unknown" role="img" aria-label="Count not loaded">—</span>
            ) : (
              String(item.count)
            )}
          </span>
        </SimpleTableCell>
      ),
      readonly: true,
      width: colWidthCount,
      ...sortProps("count"),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [selectedIds, onToggle, onToggleAll, allSelected, someSelected, onRename, existingNames, onSort, sort?.key, sort?.direction]);

  // The behavior is created once and reads the latest columns and callback through refs.
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const onSortRef = useRef(onSort);
  onSortRef.current = onSort;
  const behaviors = useMemo(
    () => [
      new ColumnSorting<TagItem>((columnIndex, proposedSortOrder) => {
        const id = columnsRef.current[columnIndex]?.id;
        if (id !== "name" && id !== "count") return;
        onSortRef.current?.({
          key: id,
          direction: proposedSortOrder === SortOrder.ascending ? "asc" : "desc",
        });
      }),
    ],
    []
  );

  // Every hook above runs on every render; only the output branches below.
  if (tags.length === 0) {
    if (isFiltered) {
      return (
        <ZeroData
          primaryText="No tags match your filters"
          secondaryText="Check the spelling, or clear the search and letter filter to see every tag."
          imageAltText=""
          actionText="Clear filters"
          actionType={ZeroDataActionType.ctaButton}
          onActionClick={onClearFilters}
        />
      );
    }
    return (
      <ZeroData
        primaryText="No tags found"
        secondaryText="This project has no work item tags yet. Tags you add to work items will appear here."
        imageAltText=""
      />
    );
  }

  return (
    <Table<TagItem>
      ariaLabel="Work item tags"
      behaviors={onSort ? behaviors : undefined}
      columns={columns}
      itemProvider={tableItems}
      role="grid"
    />
  );
};
