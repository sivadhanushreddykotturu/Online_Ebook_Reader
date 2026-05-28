

export interface UploadCallbacks {
  onStatus: (status: string) => void;
  onProgress: (percent: number) => void;
}

export interface UploadResult {
  r2Key: string;
  title: string;
  totalPages: number;
}

function smoothProgress(realPercent: number): number {
  const jitter = Math.random() * 2 - 1; 
  const mapped = 5 + (realPercent / 100) * 80; 
  return Math.min(85, Math.max(5, Math.round(mapped + jitter)));
}

export async function uploadBook(
  file: File,
  totalPages: number,
  callbacks: UploadCallbacks
): Promise<UploadResult> {
  const { onStatus, onProgress } = callbacks;

  onStatus('Preparing upload…');
  onProgress(2);

  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', file.name);
  formData.append('totalPages', totalPages.toString());

  const result = await new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/books/upload');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const rawPercent = Math.round((event.loaded / event.total) * 100);
        const display = smoothProgress(rawPercent);
        onProgress(display);
        onStatus(`Uploading… ${display}%`);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          resolve({
            r2Key: res.r2Key,
            title: res.title,
            totalPages: res.totalPages,
          });
        } catch {
          reject(new Error('Failed to parse server response'));
        }
      } else {
        let msg = xhr.statusText;
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.error) msg = res.error;
        } catch {}
        reject(new Error(`Upload failed: ${xhr.status} ${msg}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.send(formData);
  });

  onProgress(100);
  onStatus('Done ✓');

  return result;
}
