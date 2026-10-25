import React from "react";

export const ColumnFillId = "__fill__";

export class ObservableValue<T = unknown> {
  constructor(public value: T) {}
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

export const Dialog: React.FC<
  React.PropsWithChildren<{
    titleProps?: { text?: string };
    footerButtonProps?: Array<{
      text: string;
      onClick?: () => void;
      disabled?: boolean;
    }>;
    onDismiss?: () => void;
  }>
> = ({ titleProps, footerButtonProps = [], onDismiss, children }) => (
  <div role="dialog">
    <h2>{titleProps?.text}</h2>
    <div>{children}</div>
    <div>
      {footerButtonProps.map((button) => (
        <button
          key={button.text}
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

export const Checkbox: React.FC<{
  checked?: boolean;
  onChange?: (_event: React.ChangeEvent<HTMLInputElement>, checked: boolean) => void;
}> = ({ checked, onChange }) => (
  <input
    type="checkbox"
    checked={Boolean(checked)}
    onChange={(event) => onChange?.(event, event.target.checked)}
  />
);

export const ZeroData: React.FC<{ primaryText?: string; secondaryText?: string }> = ({
  primaryText,
  secondaryText,
}) => (
  <div>
    <div>{primaryText}</div>
    <div>{secondaryText}</div>
  </div>
);

export const SimpleTableCell: React.FC<React.PropsWithChildren<unknown>> = ({
  children,
}) => <div>{children}</div>;

export function Table<T>(props: {
  columns: Array<{
    id: string;
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
          {props.columns.map((column, colIndex) => (
            <th key={`header-${column.id}`}>
              {column.renderHeaderCell?.(colIndex, column) ?? null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item, rowIndex) => (
          <tr key={`row-${rowIndex}`}>
            {props.columns.map((column, colIndex) => (
              <td key={`${rowIndex}-${column.id}`}>
                {column.renderCell?.(rowIndex, colIndex, column, item) ?? null}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- Tabs ----
const TabBarContext = React.createContext<(id: string) => void>(() => {});

export const TabSize = {
  Compact: "compact",
  Tall: "tall",
  LargeLink: "large-link",
};

export const TabBar: React.FC<{
  selectedTabId?: string;
  onSelectedTabChanged: (tabId: string) => void;
  tabSize?: string;
  children?: React.ReactNode;
}> = ({ children, onSelectedTabChanged }) => (
  <TabBarContext.Provider value={onSelectedTabChanged}>
    <div data-testid="ado-tab-bar">{children}</div>
  </TabBarContext.Provider>
);

export const Tab: React.FC<{
  id: string;
  name?: string;
  disabled?: boolean;
}> = ({ id, name }) => {
  const onTabChanged = React.useContext(TabBarContext);
  return (
    <button data-testid={`ado-tab-${id}`} onClick={() => onTabChanged(id)}>
      {name}
    </button>
  );
};

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

export const Pill: React.FC<
  React.PropsWithChildren<{
    size?: number;
    variant?: number;
    iconProps?: { iconName: string };
    className?: string;
  }>
> = ({ children, variant, iconProps }) => (
  <span data-testid="pill" data-variant={variant} data-icon={iconProps?.iconName}>
    {children}
  </span>
);
