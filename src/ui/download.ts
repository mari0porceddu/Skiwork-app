/**
 * Salvataggio di file generati localmente (CSV, JSON, ICS).
 * Su iPhone, nelle PWA installate, il download può aprire l'anteprima: in quel caso si usa
 * il foglio di condivisione nativo (Web Share API con file) quando disponibile.
 */
export async function saveFile(filename: string, content: string | Blob, mime: string): Promise<void> {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const file = typeof File !== 'undefined' ? new File([blob], filename, { type: mime }) : null;
  const isStandaloneIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) && (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (isStandaloneIOS && file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}
