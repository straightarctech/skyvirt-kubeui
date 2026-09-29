// SchemaForm renders the fields produced by lib/schemaForm from a chart's
// values.schema.json.
//
// It edits a SPARSE overlay, never the chart's values.yaml — see the header comment
// in lib/schemaForm.ts for why. A field the user has not touched shows the chart's
// default as a placeholder and contributes nothing to the overlay; clearing a field
// removes it again rather than pinning the default as an explicit override.

import FormField from "./FormField";
import {
  SchemaField,
  getAtPath,
  setAtPath,
  deleteAtPath,
  validateField,
} from "@/lib/schemaForm";

// The canonical input styling, matching the create modals and Catalog.tsx.
const INPUT =
  "w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent";

type Values = Record<string, unknown>;

interface SchemaFormProps {
  fields: SchemaField[];
  unsupported: string[];
  overlay: Values;
  onChange: (next: Values) => void;
}

/** Renders a default as the placeholder text for an untouched field. */
function placeholderFor(field: SchemaField): string {
  if (field.default === undefined || field.default === null) return "";
  if (Array.isArray(field.default)) return field.default.join(", ");
  return String(field.default);
}

export default function SchemaForm({ fields, unsupported, overlay, onChange }: SchemaFormProps) {
  // Set a value, or drop it from the overlay when cleared.
  const put = (field: SchemaField, value: unknown) => {
    const cleared = value === "" || value === undefined || value === null;
    onChange(cleared ? deleteAtPath(overlay, field.path) : setAtPath(overlay, field.path, value));
  };

  // Group by top-level key so a large chart reads as sections rather than a wall.
  const groups = new Map<string, SchemaField[]>();
  for (const f of fields) {
    const g = f.path.length > 1 ? f.path[0] : "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(f);
  }

  const renderControl = (field: SchemaField) => {
    const override = getAtPath(overlay, field.path);
    const touched = override !== undefined;

    switch (field.type) {
      case "boolean": {
        const checked = touched ? Boolean(override) : Boolean(field.default);
        return (
          <label className="flex items-center gap-2 text-sm text-th-body">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => put(field, e.target.checked)}
              className="rounded border-th-line"
            />
            <span className="text-th-dim">{checked ? "enabled" : "disabled"}</span>
          </label>
        );
      }

      case "enum": {
        const current = touched ? override : field.default;
        const opts = field.enum ?? [];
        // Small enums read better as the house pill row; long ones need a select.
        if (opts.length <= 4) {
          return (
            <div className="flex flex-wrap gap-1">
              {opts.map((o) => (
                <button
                  key={String(o)}
                  type="button"
                  onClick={() => put(field, o)}
                  className={`rounded-md px-2 py-1 text-xs ${
                    String(current) === String(o)
                      ? "bg-th-accent-s text-th-accent"
                      : "bg-th-panel text-th-dim hover:bg-th-hover"
                  }`}
                >
                  {String(o)}
                </button>
              ))}
            </div>
          );
        }
        return (
          <select
            className={INPUT}
            value={current === undefined ? "" : String(current)}
            onChange={(e) => put(field, e.target.value)}
          >
            <option value="">— chart default —</option>
            {opts.map((o) => (
              <option key={String(o)} value={String(o)}>
                {String(o)}
              </option>
            ))}
          </select>
        );
      }

      case "number":
        return (
          <input
            type="number"
            className={INPUT}
            placeholder={placeholderFor(field)}
            min={field.minimum}
            max={field.maximum}
            value={touched ? String(override) : ""}
            onChange={(e) => put(field, e.target.value === "" ? "" : Number(e.target.value))}
          />
        );

      case "array":
        return (
          <input
            type="text"
            className={INPUT}
            placeholder={placeholderFor(field) || "comma separated"}
            value={touched && Array.isArray(override) ? (override as unknown[]).join(", ") : ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw.trim() === "") return put(field, "");
              const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
              put(field, field.itemType === "number" ? parts.map(Number) : parts);
            }}
          />
        );

      default:
        return (
          <input
            type="text"
            className={INPUT}
            placeholder={placeholderFor(field)}
            value={touched ? String(override) : ""}
            onChange={(e) => put(field, e.target.value)}
          />
        );
    }
  };

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([group, groupFields]) => (
        <div key={group || "_root"} className="space-y-3">
          {group && (
            <div className="border-b border-th-line pb-1 text-xs font-medium uppercase tracking-wide text-th-dim">
              {group}
            </div>
          )}
          {groupFields.map((field) => {
            const override = getAtPath(overlay, field.path);
            const touched = override !== undefined;
            const error = validateField(field, touched ? override : field.default);
            return (
              <FormField
                key={field.key}
                label={field.path.length > 1 ? field.path.slice(1).join(".") : field.title}
                description={field.description}
                required={field.required}
                error={error}
              >
                <div className="space-y-1">
                  {renderControl(field)}
                  {touched && (
                    <button
                      type="button"
                      onClick={() => onChange(deleteAtPath(overlay, field.path))}
                      className="text-xs text-th-accent hover:underline"
                    >
                      reset to chart default
                    </button>
                  )}
                </div>
              </FormField>
            );
          })}
        </div>
      ))}

      {unsupported.length > 0 && (
        <div className="rounded-lg border border-th-line bg-th-subtle p-3 text-xs text-th-dim">
          <span className="text-th-body">
            {unsupported.length} value{unsupported.length === 1 ? "" : "s"} not editable here
          </span>{" "}
          — nested lists and conditional schema constructs. Switch to the YAML tab to set{" "}
          <span className="font-mono">{unsupported.slice(0, 6).join(", ")}</span>
          {unsupported.length > 6 && ` and ${unsupported.length - 6} more`}.
        </div>
      )}

      {fields.length === 0 && (
        <div className="rounded-lg border border-th-line bg-th-subtle p-3 text-xs text-th-dim">
          This chart ships a schema, but it declares no fields this form can render. Use
          the YAML tab.
        </div>
      )}
    </div>
  );
}
