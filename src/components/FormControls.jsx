export function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function TextInput(props) {
  return <input className="input" {...props} />;
}

export function TextArea(props) {
  return <textarea className="textarea" {...props} />;
}

export function Select(props) {
  return <select className="select" {...props} />;
}

export function ChoiceGrid({ options, values, onChange, disabled }) {
  const selected = new Set(values || []);
  return (
    <div className="choice-grid">
      {options.map((option) => (
        <label key={option.value} className={`choice ${selected.has(option.value) ? "selected" : ""}`}>
          <input
            type="checkbox"
            checked={selected.has(option.value)}
            disabled={disabled}
            onChange={(event) => {
              const next = new Set(selected);
              if (event.target.checked) next.add(option.value);
              else next.delete(option.value);
              onChange([...next]);
            }}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
