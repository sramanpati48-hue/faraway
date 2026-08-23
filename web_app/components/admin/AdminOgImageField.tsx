"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { adminBtnSecondary, adminInput } from "@/components/admin/admin-ui";
import { adminApi } from "@/lib/adminApi";
import { DEFAULT_OG_IMAGE } from "@/lib/seo/og-image-defaults";
import { cn } from "@/lib/utils";

type Props = {
  label?: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  /** Shown as input placeholder / empty preview fallback */
  placeholder?: string;
  /** Cloudinary folder (must be allowed by /api/admin/upload/image) */
  folder?: "site" | "articles" | "general" | "heroes";
  hint?: string;
  onError?: (message: string) => void;
};

export function AdminOgImageField({
  label = "OG image URL",
  value,
  onChange,
  placeholder,
  folder = "site",
  hint,
  onError,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const display = value ?? "";
  const preview = display || placeholder || DEFAULT_OG_IMAGE;

  const reportError = (message: string) => {
    setLocalError(message);
    onError?.(message);
  };

  const upload = async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      reportError("Please choose an image file (JPEG, PNG, WebP, or GIF).");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reportError("Image is too large (max 8 MB).");
      return;
    }
    setUploading(true);
    setLocalError(null);
    try {
      const res = await adminApi.uploadImage(file, folder);
      if (!res.url) throw new Error("Upload succeeded but no URL was returned");
      onChange(res.url);
    } catch (e: unknown) {
      reportError(e instanceof Error ? e.message : "Cloudinary upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="block text-xs text-white/50">
      <span className="mb-1 block">{label}</span>
      {hint ? <p className="mb-1.5 text-[11px] text-white/30">{hint}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          className={cn(adminInput, "min-w-0 flex-1")}
          value={display}
          onChange={(e) => onChange(e.target.value.trim() ? e.target.value : null)}
          placeholder={placeholder || "https://… or upload via Cloudinary"}
        />
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        <button
          type="button"
          className={cn(adminBtnSecondary, "shrink-0")}
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="mr-1.5 h-4 w-4" />
          )}
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>
      {localError ? <p className="mt-1.5 text-[11px] text-red-300">{localError}</p> : null}
      {preview ? (
        <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.08] bg-black/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="OG preview" className="max-h-36 w-full object-cover" />
        </div>
      ) : null}
    </div>
  );
}
