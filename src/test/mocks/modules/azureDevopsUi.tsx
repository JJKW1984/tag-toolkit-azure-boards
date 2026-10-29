import React from "react";

export const ColumnFillId = "__fill__";

/** Notifies subscribers when `value` is set to something different, like the real one. */
export class ObservableValue<T = unknown> {
  private current: T;
  private subscribers = new Set<(value: T) => void>();

  constructor(value: T) {
    this.current = value;
  }

  get value(): T {
    return this.current;
  }

  set value(next: T) {
    if (next === this.current) return;
    this.current = next;
    this.subscribers.forEach((notify) => notify(next));
  }

  subscribe(notify: (value: T) => void): (value: T) => void {
    this.subscribers.add(notify);
    return notify;
  }

  unsubscribe(notify: (value: T) => void): void {
    this.subscribers.delete(notify);
  }
}

/**
 * Like the real Observer: each prop that is an ObservableValue is read and re-rendered on change,
 * other props pass through, and the children are a function of the resulting values.
 */
export function Observer({
  children,
  ...watched
}: { children: (values: Record<string, any>) => React.ReactNode } & Record<string, unknown>): JSX.Element {
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  const observables = Object.values(watched).filter((v): v is ObservableValue => v instanceof ObservableValue);

  React.useLayoutEffect(() => {
    observables.forEach((o) => o.subscribe(rerender));
    return () => observables.forEach((o) => o.unsubscribe(rerender));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, observables);

  const values: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(watched)) values[key] = v instanceof ObservableValue ? v.value : v;
  return <>{children(values)}</>;
}

export class ArrayItemProvider<T> {
  constructor(private items: T[]) {}

  public length = this.items.length;

  public getItem(index: number): T {
    return this.items[index];
  }

  public getItems(): T[] {
    return this.items;
  }
}

export const Card: React.FC<React.PropsWithChildren<unknown>> = ({ children }) => (
  <div data-testid="ado-card">{children}</div>
);

export const Page: React.FC<React.PropsWithChildren<{ className?: string }>> = ({
  children,
  className,
}) => <div className={className}>{children}</div>;

export const TitleSize = {
  Large: "large",
};

interface HeaderItem {
  id: string;
  text: string;
  disabled?: boolean;
  onActivate?: () => void;
  iconProps?: { iconName: string };
}

export const Header: React.FC<{
  title: string;
  description?: string;
  commandBarItems?: HeaderItem[];
}> = ({ title, description, commandBarItems = [] }) => (
  <div>
    <h1>{title}</h1>
    {description ? <p>{description}</p> : null}
    <div>
      {commandBarItems.map((item) => (
        <button
          key={item.id}
          data-icon={item.iconProps?.iconName}
          disabled={item.disabled}
          onClick={() => item.onActivate?.()}
        >
          {item.text}
        </button>
      ))}
    </div>
  </div>
);

export const SpinnerSize = {
  small: "small",
  large: "large",
};

export const Spinner: React.FC<{ label?: string }> = ({ label }) => (
  <div>{label ?? "Loading"}</div>
);

export const MessageCardSeverity = {
  Error: "error",
  Warning: "warning",
  Info: "info",
};

export const MessageCard: React.FC<
  React.PropsWithChildren<{ onDismiss?: () => void }>
> = ({ children, onDismiss }) => (
  <div>
    <div>{children}</div>
    {onDismiss ? <button onClick={onDismiss}>Dismiss</button> : null}
  </div>
);

export const FormItem: React.FC<
  React.PropsWithChildren<{ label?: string }>
> = ({ label, children }) => (
  <label>
    {label ? <span>{label}</span> : null}
    {children}
  </label>
);

/**
 * Follows the real Dialog's keyboard contract: `enterPrimary` defaults to true, so Enter presses
 * the primary footer button, `escDismiss` defaults to true, and `defaultActiveElement` is the
 * selector that gets focus on open. Like the real Button, a footer button swallows Escape
 * (blurring itself and stopping the event), so the dialog never sees it from a focused button.
 */
export const Dialog: React.FC<
  React.PropsWithChildren<{
    titleProps?: { text?: string };
    footerButtonProps?: Array<{
      className?: string;
      text: string;
      onClick?: () => void;
      disabled?: boolean;
      primary?: boolean;
    }>;
    defaultActiveElement?: string;
    enterPrimary?: boolean;
    escDismiss?: boolean;
    onDismiss?: () => void;
  }>
> = ({
  titleProps,
  footerButtonProps = [],
  defaultActiveElement,
  enterPrimary = true,
  escDismiss = true,
  onDismiss,
  children,
}) => {
  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const target = defaultActiveElement
      ? rootRef.current?.querySelector<HTMLElement>(defaultActiveElement)
      : null;
    target?.focus();
  }, [defaultActiveElement]);

  return (
    <div
      role="dialog"
      ref={rootRef}
      onKeyDown={(e) => {
        const primary = footerButtonProps.find((button) => button.primary);
        if (enterPrimary && primary && e.key === "Enter" && !e.defaultPrevented && !primary.disabled) {
          primary.onClick?.();
        }
        if (escDismiss && e.key === "Escape" && !e.defaultPrevented) {
          onDismiss?.();
        }
      }}
    >
      <h2>{titleProps?.text}</h2>
      <div>{children}</div>
      <div>
        {footerButtonProps.map((button) => (
          <button
            key={button.text}
            className={button.className}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.currentTarget.blur();
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onClick={() => button.onClick?.()}
            disabled={button.disabled}
          >
            {button.text}
          </button>
        ))}
      </div>
      {onDismiss ? <button onClick={onDismiss}>Close</button> : null}
    </div>
  );
};

type CheckboxProps = {
  ariaLabel?: string;
  checked?: boolean;
  triState?: boolean;
  onChange?: (_event: React.ChangeEvent<HTMLInputElement>, checked: boolean) => void;
};

/** The tri-state box: `checked: undefined` is the indeterminate state, shown as "mixed". */
export const TriStateCheckbox: React.FC<CheckboxProps> = ({ ariaLabel, checked, triState, onChange }) => {
  const mixed = Boolean(triState) && checked === undefined;
  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      aria-checked={mixed ? "mixed" : Boolean(checked)}
      checked={Boolean(checked)}
      ref={(el) => {
        if (el) el.indeterminate = mixed;
      }}
      onChange={(event) =>
        // The real transitions: unchecked -> checked, checked -> indeterminate (tri-state) or unchecked,
        // indeterminate -> unchecked. They come from the props, not from the native input.
        onChange?.(event, checked === false ? true : checked === true ? (triState ? (undefined as never) : false) : false)
      }
    />
  );
};

/**
 * The plain box has `defaultProps = { checked: false }`, so `checked={undefined}` becomes false and it
 * can never show the indeterminate state, whatever `triState` says. Use TriStateCheckbox for that.
 */
export const Checkbox: React.FC<CheckboxProps> = ({ checked = false, ...rest }) => (
  <TriStateCheckbox {...rest} checked={checked} />
);

export const ZeroDataActionType = {
  ctaButton: 0,
  link: 2,
};

export const ZeroData: React.FC<{
  primaryText?: string;
  secondaryText?: string;
  actionText?: string;
  onActionClick?: () => void;
}> = ({ primaryText, secondaryText, actionText, onActionClick }) => (
  <div>
    <div>{primaryText}</div>
    <div>{secondaryText}</div>
    {actionText ? <button onClick={() => onActionClick?.()}>{actionText}</button> : null}
  </div>
);

export const SimpleTableCell: React.FC<React.PropsWithChildren<unknown>> = ({
  children,
}) => <div>{children}</div>;

export const SortOrder = { ascending: 0, descending: 1 };
export const ColumnJustification = { Left: 0, Right: 1 };

/** Holds the delegate; the Table mock calls it the way the real behavior does on a header click. */
export class ColumnSorting<T = unknown> {
  constructor(
    public onSort: (
      columnIndex: number,
      proposedSortOrder: number,
      event: React.MouseEvent<HTMLElement>
    ) => void
  ) {}
  public items?: T[];
}

/**
 * The real Table re-renders a row when its item or the item provider changes, not when only the
 * `columns` prop does: existing rows keep the cell closures they were created with, so a cell that
 * reads state through a closure shows what it saw when the row was created. Rows are memoized the
 * same way here so a cell has to subscribe to what it shows.
 */
const TableRow = React.memo(
  function TableRow({
    item,
    rowIndex,
    columns,
  }: {
    item: unknown;
    rowIndex: number;
    provider: unknown;
    columns: Array<{
      id: string;
      renderCell?: (rowIndex: number, columnIndex: number, tableColumn: unknown, item: any) => React.ReactNode;
    }>;
  }) {
    return (
      <tr>
        {columns.map((column, colIndex) => (
          <td key={`${rowIndex}-${column.id}`}>{column.renderCell?.(rowIndex, colIndex, column, item) ?? null}</td>
        ))}
      </tr>
    );
  },
  (prev, next) => prev.item === next.item && prev.rowIndex === next.rowIndex && prev.provider === next.provider
);

export function Table<T>(props: {
  behaviors?: unknown[];
  columns: Array<{
    id: string;
    name?: string;
    sortProps?: { sortOrder?: number };
    renderHeaderCell?: (
      columnIndex: number,
      tableColumn: unknown
    ) => React.ReactNode;
    renderCell?: (
      rowIndex: number,
      columnIndex: number,
      tableColumn: unknown,
      item: T
    ) => React.ReactNode;
  }>;
  itemProvider: {
    getItems?: () => T[];
    length?: number;
    getItem?: (index: number) => T;
  };
}): JSX.Element {
  const items = props.itemProvider.getItems
    ? props.itemProvider.getItems()
    : Array.from({ length: props.itemProvider.length ?? 0 }, (_v, i) =>
        props.itemProvider.getItem ? props.itemProvider.getItem(i) : (undefined as unknown as T)
      );

  return (
    <table>
      <thead>
        <tr>
          {props.columns.map((column, colIndex) => {
            const sorting = props.behaviors?.find((b) => b instanceof ColumnSorting) as
              | ColumnSorting
              | undefined;
            const sortOrder = column.sortProps?.sortOrder;
            return (
              <th
                key={`header-${column.id}`}
                aria-sort={
                  sortOrder === undefined
                    ? undefined
                    : sortOrder === SortOrder.ascending
                    ? "ascending"
                    : "descending"
                }
              >
                {column.renderHeaderCell ? (
                  column.renderHeaderCell(colIndex, column)
                ) : column.sortProps && sorting ? (
                  <button
                    onClick={(e) =>
                      // The real behavior proposes ascending unless the column is already ascending.
                      sorting.onSort(
                        colIndex,
                        sortOrder === SortOrder.ascending ? SortOrder.descending : SortOrder.ascending,
                        e
                      )
                    }
                  >
                    {column.name}
                  </button>
                ) : (
                  column.name ?? null
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {items.map((item, rowIndex) => (
          <TableRow
            key={`row-${rowIndex}`}
            item={item}
            rowIndex={rowIndex}
            provider={props.itemProvider}
            columns={props.columns}
          />
        ))}
      </tbody>
    </table>
  );
}

// ---- Dropdown ----
/** The real selection is observable: a Dropdown re-renders when something selects an index. */
export class ListSelection {
  value: Array<{ beginIndex: number; endIndex: number }> = [];
  private listeners = new Set<() => void>();

  select(index: number) {
    this.value = [{ beginIndex: index, endIndex: index }];
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export class DropdownSelection extends ListSelection {}

/**
 * A native select: enough to pick an item and see which one is selected. A class like the
 * real component, so a ref reaches `collapse()`. Like the real one it subscribes to the
 * selection in componentDidMount, and `renderSelectedItems` receives the selection and ALL
 * the items (not just the selected ones); its result is what the closed dropdown displays.
 */
type MockDropdownItem = { id: string; text?: string };
type MockDropdownProps = {
  ariaLabel?: string;
  items?: MockDropdownItem[];
  selection: ListSelection;
  onSelect?: (event: React.SyntheticEvent, item: MockDropdownItem) => void;
  renderSelectedItems?: (selection: ListSelection, items: MockDropdownItem[]) => string;
};

export class Dropdown extends React.Component<MockDropdownProps> {
  /** Lets tests see that the list was asked to close. */
  public static collapseCalls = 0;
  private unsubscribe?: () => void;

  componentDidMount() {
    this.unsubscribe = this.props.selection.subscribe(() => this.forceUpdate());
  }

  componentWillUnmount() {
    this.unsubscribe?.();
  }

  collapse = () => {
    Dropdown.collapseCalls += 1;
  };

  render() {
    const { ariaLabel, items = [], selection, onSelect, renderSelectedItems } = this.props;
    return (
      <>
        <select
          aria-label={ariaLabel}
          value={selection.value[0]?.beginIndex ?? -1}
          onChange={(e) => onSelect?.(e, items[Number(e.target.value)])}
        >
          {selection.value.length === 0 ? <option value={-1} /> : null}
          {items.map((item, index) => (
            <option key={item.id} value={index}>
              {item.text}
            </option>
          ))}
        </select>
        {renderSelectedItems ? (
          <span data-testid="dropdown-text">{renderSelectedItems(selection, items)}</span>
        ) : null}
      </>
    );
  }
}

// ---- Button / ButtonGroup ----
export const Button: React.FC<{
  text?: string;
  subtle?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  iconProps?: { iconName: string };
}> = ({ text, disabled, onClick }) => (
  <button disabled={disabled} onClick={onClick}>
    {text}
  </button>
);

export const ButtonGroup: React.FC<React.PropsWithChildren<unknown>> = ({
  children,
}) => <div data-testid="ado-button-group">{children}</div>;

// ---- Pill ----
export const PillSize = {
  compact: 0,
  regular: 1,
  large: 2,
};

export const PillVariant = {
  standard: 0,
  outlined: 1,
  colored: 2,
  themedStandard: 3,
};

/**
 * Like the real Pill, the content element carries `data-focuszone` unless `excludeFocusZone` is set.
 * Inside a Dialog the FocusZone counts every such element as a Tab stop even though a pill with no
 * onClick is not focusable, so Tab lands on it, goes nowhere and never reaches the controls after it.
 */
export const Pill: React.FC<
  React.PropsWithChildren<{
    size?: number;
    variant?: number;
    iconProps?: { iconName: string };
    className?: string;
    contentClassName?: string;
    excludeFocusZone?: boolean;
  }>
> = ({ children, variant, iconProps, excludeFocusZone }) => (
  <span
    data-testid="pill"
    data-variant={variant}
    data-icon={iconProps?.iconName}
    data-focuszone={excludeFocusZone ? undefined : "mock-focuszone"}
  >
    {children}
  </span>
);

// ---- Toast ----
export class Toast extends React.Component<{
  message: string;
  callToAction?: string;
  onCallToActionClick?: () => void;
}> {
  fadeOut(): { promise: Promise<void>; cancel: () => void } {
    return { promise: Promise.resolve(), cancel: () => {} };
  }

  render() {
    const { message, callToAction, onCallToActionClick } = this.props;
    return (
      <div>
        <span role="alert">{message}</span>
        {callToAction ? <button onClick={() => onCallToActionClick?.()}>{callToAction}</button> : null}
      </div>
    );
  }
}

// ---- Icon ----
export const IconSize = { inherit: "inherit", small: "small", medium: "medium", large: "large" };

export const Icon: React.FC<{ iconName?: string; className?: string; size?: string }> = ({ iconName, className }) => (
  <span aria-hidden="true" data-icon={iconName} className={className} />
);
