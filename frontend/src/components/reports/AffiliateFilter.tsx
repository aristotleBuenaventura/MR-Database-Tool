import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

export type FilterField = {
  id: string;
  label: string;
  type?: "text" | "date";
};

export type FilterValues = Record<string, string | string[]>;

type Props = {
  title?: string;
  fields: FilterField[];
  values: FilterValues;
  /** Unique usernames from the current table (for suggestions). */
  usernameOptions?: string[];
  hint?: string | null;
  onChange: (id: string, value: string | string[]) => void;
};

function isUsernameField(field: FilterField): boolean {
  return (
    field.id === "affiliateUsername" ||
    field.label.toLowerCase().includes("affiliate username")
  );
}

function UsernameMultiSearch({
  label,
  selected,
  options,
  onChange,
}: {
  label: string;
  selected: string[];
  options: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedSet = useMemo(
    () => new Set(selected.map((name) => name.toLowerCase())),
    [selected],
  );

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return options
      .filter(
        (name) =>
          name.toLowerCase().includes(q) && !selectedSet.has(name.toLowerCase()),
      )
      .slice(0, 40);
  }, [options, query, selectedSet]);

  useEffect(() => {
    function onDocPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, []);

  function addUsername(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (selectedSet.has(trimmed.toLowerCase())) {
      setQuery("");
      return;
    }
    onChange([...selected, trimmed]);
    setQuery("");
    setOpen(true);
    inputRef.current?.focus();
  }

  function removeUsername(name: string) {
    const key = name.toLowerCase();
    onChange(selected.filter((item) => item.toLowerCase() !== key));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !query && selected.length > 0) {
      event.preventDefault();
      removeUsername(selected[selected.length - 1]!);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (suggestions[0]) addUsername(suggestions[0]);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <label className="mr-username-filter">
      <span>{label}</span>
      <div className="mr-chip-input" ref={rootRef}>
        <div
          className="mr-chip-input-box"
          onClick={() => inputRef.current?.focus()}
        >
          {selected.map((name) => (
            <span key={name} className="mr-chip">
              <span className="mr-chip-label">{name}</span>
              <button
                type="button"
                className="mr-chip-remove"
                aria-label={`Remove ${name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  removeUsername(name);
                }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={selected.length ? "Add username…" : "Type to search username…"}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            aria-autocomplete="list"
            aria-expanded={open && suggestions.length > 0}
          />
        </div>

        {open && query.trim() ? (
          <ul className="mr-suggest-list" role="listbox">
            {suggestions.length === 0 ? (
              <li className="mr-suggest-empty">No matching username</li>
            ) : (
              suggestions.map((name) => (
                <li key={name} role="option">
                  <button
                    type="button"
                    className="mr-suggest-item"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => addUsername(name)}
                  >
                    {name}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
      {selected.length > 0 ? (
        <small className="mr-chip-hint">
          Table order follows username chips ({selected.length} selected)
        </small>
      ) : null}
    </label>
  );
}

export function AffiliateFilter({
  title = "AFFILIATE FILTER",
  fields,
  values,
  usernameOptions = [],
  hint,
  onChange,
}: Props) {
  const dateFrom = typeof values.dateFrom === "string" ? values.dateFrom : "";
  const dateTo = typeof values.dateTo === "string" ? values.dateTo : "";

  return (
    <section className="mr-filter">
      <h2>{title}</h2>
      <div className="mr-filter-grid">
        {fields.map((field) => {
          if (isUsernameField(field)) {
            const selected = Array.isArray(values[field.id])
              ? (values[field.id] as string[])
              : [];
            return (
              <UsernameMultiSearch
                key={field.id}
                label={field.label}
                selected={selected}
                options={usernameOptions}
                onChange={(next) => onChange(field.id, next)}
              />
            );
          }

          const value =
            typeof values[field.id] === "string" ? (values[field.id] as string) : "";

          return (
            <label key={field.id}>
              <span>{field.label}</span>
              <input
                type={field.type === "date" ? "date" : "text"}
                value={value}
                min={
                  field.type === "date" && field.id === "dateTo" && dateFrom
                    ? dateFrom
                    : undefined
                }
                max={
                  field.type === "date" && field.id === "dateFrom" && dateTo
                    ? dateTo
                    : undefined
                }
                onChange={(e) => onChange(field.id, e.target.value)}
              />
            </label>
          );
        })}
      </div>
      {hint ? <p className="mr-field-hint">{hint}</p> : null}
    </section>
  );
}
