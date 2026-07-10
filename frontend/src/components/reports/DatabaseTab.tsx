import { DATABASE_CATEGORIES } from "../../config/reports";
import { ExportButton } from "./ExportButton";

type Props = {
  canImportExport: boolean;
  fileName: string;
  location: string;
  onLocationChange: (value: string) => void;
  onPickFile: (file: File) => void;
  busy?: boolean;
  categoryData: Record<string, string[][]>;
};

export function DatabaseTab({
  canImportExport,
  fileName,
  location,
  onLocationChange,
  onPickFile,
  busy = false,
  categoryData,
}: Props) {
  return (
    <div className="mr-database">
      <section className="mr-upload">
        <h2>FILE UPLOAD</h2>
        {canImportExport ? (
          <div className="mr-database-fields">
            <label>
              <span>FILE NAME</span>
              <div className="mr-upload-row">
                <input type="text" value={fileName} placeholder="Selected file name" readOnly />
                <label className={`mr-file-btn ${busy ? "disabled" : ""}`}>
                  {busy ? "Reading..." : "Choose file"}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    hidden
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) onPickFile(file);
                    }}
                  />
                </label>
              </div>
            </label>
            <label>
              <span>LOCATION</span>
              <input
                type="text"
                value={location}
                onChange={(e) => onLocationChange(e.target.value)}
                placeholder="e.g. TK BDT / Aff Raw"
              />
            </label>
          </div>
        ) : (
          <p className="mr-readonly-note">File upload is available to Admin accounts only.</p>
        )}
      </section>

      {DATABASE_CATEGORIES.map((category) => {
        const rows = categoryData[category.id] ?? [];
        return (
          <section key={category.id} className="mr-db-category">
            <div className="mr-section-bar">
              <span className="mr-section-label">{category.label}</span>
              <ExportButton canExport={canImportExport} />
            </div>
            <div className="mr-no-data">
              {rows.length > 0 ? `${rows.length} row(s) loaded` : "No Data"}
            </div>
          </section>
        );
      })}
    </div>
  );
}
