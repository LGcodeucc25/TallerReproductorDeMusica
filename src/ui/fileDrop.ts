/**
 * Collects files from a drop, including the contents of dropped folders
 * (Chrome, Edge, Firefox and Safari support webkitGetAsEntry).
 */
export async function filesFromDrop(transfer: DataTransfer): Promise<File[]> {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(transfer.items)) {
    const entry = item.kind === 'file' ? item.webkitGetAsEntry?.() : null;
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return Array.from(transfer.files);

  const files: File[] = [];
  for (const entry of entries) await collect(entry, files);
  return files;
}

async function collect(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) =>
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null)),
    );
    if (file) out.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns results in batches: keep reading until it is empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
      if (batch.length === 0) break;
      for (const child of batch) await collect(child, out);
    }
  }
}

export function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}
