import { useState, useRef, useCallback, useEffect } from "react";
import jsYaml from "js-yaml";

interface YAMLEditorProps {
  value: string;
  onChange?: (value: string) => void;
  error?: string | null;
  readOnly?: boolean;
  height?: string;
}

export default function YAMLEditor({ value, onChange, error, readOnly, height = "400px" }: YAMLEditorProps) {
  const [parseError, setParseError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lineCount = value.split("\n").length;

  const validate = useCallback((text: string) => {
    try {
      jsYaml.loadAll(text);
      setParseError(null);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setParseError(err.message);
      } else {
        setParseError("Invalid YAML");
      }
    }
  }, []);

  useEffect(() => {
    validate(value);
  }, [value, validate]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange?.(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = value.substring(0, start) + "  " + value.substring(end);
      onChange?.(newValue);

      requestAnimationFrame(() => {
        textarea.selectionStart = start + 2;
        textarea.selectionEnd = start + 2;
      });
    }
  };

  const handleScroll = () => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const displayError = error || parseError;

  return (
    <div className="flex flex-col">
      <div
        className="flex rounded border border-th-line overflow-hidden"
        style={{ height }}
      >
        <div
          ref={gutterRef}
          className="bg-th-subtle text-th-ghost text-sm select-none overflow-hidden shrink-0 py-2 text-right"
          style={{ fontFamily: "ui-monospace, monospace", width: "3.5rem" }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="px-2 leading-5">
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          readOnly={readOnly}
          spellCheck={false}
          className="flex-1 bg-th-subtle text-th-body text-sm p-2 resize-none outline-none leading-5 overflow-auto"
          style={{ fontFamily: "ui-monospace, monospace", tabSize: 2 }}
        />
      </div>
      {displayError && (
        <p className="text-xs text-th-danger mt-1">{displayError}</p>
      )}
    </div>
  );
}
