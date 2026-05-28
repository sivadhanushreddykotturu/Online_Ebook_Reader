

export interface UploadCallbacks {
  onStatus: (status: string) => void;
  onProgress: (percent: number) => void;
}

export interface UploadResult {
  r2Key: string;
  title: string;
  totalPages: number;
}


export async function uploadBook(
  file: File,
  totalPages: number,
  callbacks: UploadCallbacks
): Promise<UploadResult> {
  const { onStatus, onProgress } = callbacks;

  onStatus('Preparing upload…');
  onProgress(2);

  try {
    // 1. Get presigned URL
    onStatus('Generating upload token…');
    const tokenRes = await fetch(`/api/books/upload/token?filename=${encodeURIComponent(file.name)}`);
    if (!tokenRes.ok) {
      throw new Error(`Failed to generate upload token: ${tokenRes.statusText}`);
    }
    const { uploadUrl, r2Key } = await tokenRes.json();
    onProgress(5);

    // 2. Upload PDF directly to R2
    onStatus('Uploading PDF file…');
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', 'application/pdf');

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const rawPercent = Math.round((event.loaded / event.total) * 100);
          const display = 5 + Math.round((rawPercent / 100) * 80);
          onProgress(display);
          onStatus(`Uploading PDF… ${display}%`);
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200) {
          resolve();
        } else {
          reject(new Error(`Direct upload failed with status: ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during direct R2 upload.'));
      xhr.send(file);
    });

    onProgress(88);
    onStatus('Saving metadata and cover…');

    // 3. Post metadata and cover blob to server
    const formData = new FormData();
    formData.append('r2Key', r2Key);
    formData.append('title', file.name);
    formData.append('totalPages', totalPages.toString());

    const saveResult = await new Promise<UploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/books/upload');

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
          reject(new Error(`Save failed: ${xhr.status} ${msg}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during save.'));
      xhr.send(formData);
    });

    onProgress(100);
    onStatus('Done ✓');

    return saveResult;
  } catch (err) {
    onProgress(0);
    const errMsg = err instanceof Error ? err.message : String(err);
    onStatus(`Error: ${errMsg}`);
    throw err;
  }
}
