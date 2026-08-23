export type ChatAttachmentPayload = {
  name: string;
  text?: string;
  content_type?: string;
  content?: string;
};

export const COMPOSER_FILE_ACCEPT =
  "image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,application/pdf,text/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const MAX_INLINE_BYTES = 6_000_000;

async function fileToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function isRasterImage(file: File) {
  if (file.type.startsWith("image/") && !/heic|heif/i.test(file.type)) return true;
  return /\.(jpe?g|png|webp|gif)$/i.test(file.name);
}

async function compressImage(file: File): Promise<Blob> {
  if (!isRasterImage(file)) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image"));
      el.src = url;
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.72);
    });
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function filesToChatAttachments(files: File[]): Promise<ChatAttachmentPayload[]> {
  const payloads: ChatAttachmentPayload[] = [];
  for (const file of files) {
    const item: ChatAttachmentPayload = { name: file.name, content_type: file.type };
    if (file.type.startsWith("text/") || /\.(txt|md|json|csv)$/i.test(file.name)) {
      try {
        item.text = (await file.text()).slice(0, 12000);
      } catch {
        /* ignore */
      }
    } else {
      try {
        const blob = await compressImage(file);
        if (blob.size <= MAX_INLINE_BYTES) {
          item.content = await fileToBase64(blob);
          if (blob.type) item.content_type = blob.type;
        } else {
          item.text = `Attached file "${file.name}" was too large to send inline. Ask the user to paste the key lines or a smaller photo.`;
        }
      } catch {
        /* ignore */
      }
    }
    payloads.push(item);
  }
  return payloads;
}
