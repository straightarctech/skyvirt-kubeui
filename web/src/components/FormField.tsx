interface FormFieldProps {
  label: string;
  description?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}

export default function FormField({ label, description, required, error, children }: FormFieldProps) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-th-body">
        {label}
        {required && <span className="text-th-danger ml-1">*</span>}
      </label>
      {description && <p className="text-xs text-th-dim">{description}</p>}
      {children}
      {error && <p className="text-xs text-th-danger">{error}</p>}
    </div>
  );
}
