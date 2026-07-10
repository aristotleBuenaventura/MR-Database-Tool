type FilterField = {
  id: string;
  label: string;
};

type Props = {
  title?: string;
  fields: FilterField[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
};

export function AffiliateFilter({
  title = "AFFILIATE FILTER",
  fields,
  values,
  onChange,
}: Props) {
  return (
    <section className="mr-filter">
      <h2>{title}</h2>
      <div className="mr-filter-grid">
        {fields.map((field) => (
          <label key={field.id}>
            <span>{field.label}</span>
            <input
              type="text"
              value={values[field.id] ?? ""}
              onChange={(e) => onChange(field.id, e.target.value)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
