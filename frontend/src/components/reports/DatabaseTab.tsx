import { DATABASE_CATEGORIES } from "../../config/reports";
import { ExportButton } from "./ExportButton";

type Props = {
  canImportExport: boolean;
  fileName: string;
  location: string;
  onFileNameChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onFileSelect: (file: File | null) => void;
};

export function DatabaseTab({
  canImportExport,
  fileName,
  location,
  onFileNameChange,
  onLocationChange,
  onFileSelect,
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
                <input
                  type="text"
                  value={fileName}
                  placeholder="Selected file name"
                  readOnly
                />
                <label className="mr-file-btn">
                  Choose file
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      onFileSelect(file);
                      onFileNameChange(file?.name ?? "");
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

      {DATABASE_CATEGORIES.map((category) => (
        <section key={category.id} className="mr-db-category">
          <div className="mr-section-bar">
            <span className="mr-section-label">{category.label}</span>
            <ExportButton canExport={canImportExport} />
          </div>
          <div className="mr-no-data">No Data</div>
        </section>
      ))}
    </div>
  );
}
