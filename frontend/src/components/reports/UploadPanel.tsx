type Props = {
  title: string;
  canUpload: boolean;
  fileName: string;
  onFileNameChange: (value: string) => void;
  onFileSelect?: (file: File | null) => void;
};

export function UploadPanel({
  title,
  canUpload,
  fileName,
  onFileNameChange,
  onFileSelect,
}: Props) {
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
        <input
          type="text"
          placeholder="Selected file name"
          value={fileName}
          onChange={(e) => onFileNameChange(e.target.value)}
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
              onFileSelect?.(file);
              onFileNameChange(file?.name ?? "");
            }}
          />
        </label>
      </div>
    </section>
  );
}
