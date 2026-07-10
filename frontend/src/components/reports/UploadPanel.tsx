type Props = {
  title: string;
  canUpload: boolean;
  fileName: string;
  onPickFile: (file: File) => void;
  busy?: boolean;
};

export function UploadPanel({ title, canUpload, fileName, onPickFile, busy = false }: Props) {
  if (!canUpload) {
    return (
      <section className="mr-upload">
        <h2>{title}</h2>
        <p className="mr-readonly-note">Upload is available to Admin accounts only.</p>
      </section>
    );
  }

  return (
    <section className="mr-upload">
      <h2>{title}</h2>
      <div className="mr-upload-row">
        <input type="text" placeholder="Selected file name" value={fileName} readOnly />
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
    </section>
  );
}
