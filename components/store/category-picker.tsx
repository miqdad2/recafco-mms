"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";

import { inputCls } from "@/components/store/offline-inventory-types";
import { categoryMatchKey, newCategoryProblem } from "@/lib/store/material-edit";

// Searchable category list with "+ Add New Category". Opens in the page
// flow (not floating), so a modal's scroll area can never clip it. A new
// category is only held here: it is saved with the material on Save Changes,
// so cancelling the form leaves nothing behind.

export function CategoryPicker({
  id,
  value,
  categories,
  pendingNew,
  disabled,
  invalid,
  onSelect,
  onAddNew,
}: {
  id: string;
  value: string;
  categories: string[];
  // A new category entered in this form and not saved yet.
  pendingNew: string | null;
  disabled?: boolean;
  invalid?: boolean;
  onSelect: (category: string) => void;
  onAddNew: (category: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [existingMatch, setExistingMatch] = useState<string | null>(null);
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const all = useMemo(() => (pendingNew && !categories.some((c) => categoryMatchKey(c) === categoryMatchKey(pendingNew)) ? [...categories, pendingNew] : categories), [categories, pendingNew]);
  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((c) => words.every((w) => c.toLowerCase().includes(w)));
  }, [all, search]);

  function close() {
    setOpen(false);
    setAdding(false);
    setSearch("");
    setNewError(null);
    setExistingMatch(null);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }
  function choose(category: string) {
    onSelect(category);
    close();
  }
  function openList() {
    if (disabled) return;
    setOpen(true);
    setActive(Math.max(0, all.indexOf(value)));
    requestAnimationFrame(() => searchRef.current?.focus());
  }
  function addNew() {
    const name = newName.trim().replace(/\s+/g, " ");
    const problem = newCategoryProblem(name);
    if (problem) {
      setNewError(problem);
      setExistingMatch(null);
      return;
    }
    const existing = all.find((c) => categoryMatchKey(c) === categoryMatchKey(name));
    if (existing) {
      setNewError(`"${existing}" already exists.`);
      setExistingMatch(existing);
      return;
    }
    onAddNew(name);
    setNewName("");
    close();
  }
  // Escape closes the list only, never the form around it.
  function onEscape(e: React.KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    // React listens on the document itself here, so the popup's own document
    // listener must be stopped explicitly (React's runs first).
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    close();
  }

  return (
    <div>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onClick={() => (open ? close() : openList())}
        className={`${inputCls} flex items-center justify-between gap-2 text-left ${invalid ? "border-[#B91C1C]" : ""}`}
      >
        <span className={value ? "truncate text-[#111827]" : "text-[#9CA3AF]"}>
          {value || "Choose a category"}
          {value && pendingNew && value === pendingNew ? <span className="ml-1.5 text-xs font-semibold text-[#6B7280]">(new)</span> : null}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#6B7280]" aria-hidden />
      </button>

      {open ? (
        <div className="mt-1 rounded-md border border-[#D1D5DB] bg-white shadow-sm" onKeyDown={onEscape}>
          {adding ? (
            <div className="space-y-2 p-3">
              <label htmlFor={`${id}-new`} className="block text-sm font-bold text-[#374151]">New Category Name</label>
              <input
                id={`${id}-new`}
                autoFocus
                value={newName}
                data-no-dirty
                maxLength={80}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setNewError(null);
                  setExistingMatch(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addNew();
                  }
                }}
                placeholder="e.g. Hydraulic Materials"
                className={inputCls}
              />
              {newError ? (
                <p role="alert" className="text-xs font-semibold text-[#B91C1C]">
                  {newError}
                  {existingMatch ? (
                    <button type="button" onClick={() => choose(existingMatch)} className="ml-2 font-bold text-[#ED1C24] underline">
                      Select {existingMatch}
                    </button>
                  ) : null}
                </p>
              ) : (
                <p className="text-xs text-[#6B7280]">Saved with this material when you press Save Changes.</p>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setAdding(false); setNewError(null); requestAnimationFrame(() => searchRef.current?.focus()); }} className="min-h-11 rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-bold text-[#4B5563] hover:bg-gray-50">
                  Cancel
                </button>
                <button type="button" onClick={addNew} className="min-h-11 rounded-md bg-[#ED1C24] px-4 text-sm font-bold text-white hover:bg-[#c8181e]">
                  Add &amp; Select
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="relative border-b border-[#E5E7EB]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden />
                <input
                  ref={searchRef}
                  type="search"
                  role="combobox"
                  aria-label="Search categories"
                  aria-controls={listId}
                  aria-expanded
                  aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
                  value={search}
                  data-no-dirty
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActive((i) => Math.min(i + 1, shown.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActive((i) => Math.max(i - 1, 0));
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      if (shown[active]) choose(shown[active]);
                    }
                  }}
                  placeholder="Search categories"
                  className="min-h-11 w-full rounded-t-md bg-white py-2 pl-9 pr-3 text-sm placeholder:text-[#9CA3AF] focus:outline-none"
                />
              </div>
              <ul id={listId} role="listbox" aria-label="Categories" className="max-h-60 overflow-y-auto py-1">
                {shown.map((c, i) => (
                  <li
                    key={c}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={c === value}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(c)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex min-h-10 cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm ${i === active ? "bg-[#FEF2F2]" : ""} ${c === value ? "font-bold text-[#111827]" : "text-[#374151]"}`}
                  >
                    <span className="truncate">{c}{pendingNew === c ? " (new)" : ""}</span>
                    {c === value ? <Check className="h-4 w-4 shrink-0 text-[#ED1C24]" aria-hidden /> : null}
                  </li>
                ))}
                {shown.length === 0 ? <li className="px-3 py-3 text-sm text-[#6B7280]">No category matches &quot;{search.trim()}&quot;.</li> : null}
              </ul>
              <button
                type="button"
                onClick={() => {
                  setAdding(true);
                  setNewName(search.trim());
                }}
                className="flex min-h-11 w-full items-center gap-1.5 border-t border-[#E5E7EB] px-3 text-sm font-bold text-[#ED1C24] hover:bg-[#FEF2F2]"
              >
                <Plus className="h-4 w-4" aria-hidden /> Add New Category
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
