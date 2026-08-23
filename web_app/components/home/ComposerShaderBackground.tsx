"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  resolveShaderTintColor,
  resolveShaderTintFilter,
  type ComposerShaderTintColor,
} from "@/lib/home/composerBackground";
import { cn } from "@/lib/utils";

type ComposerShaderBackgroundProps = {
  shaderId: string;
  tintColorId: string;
  tintHue?: number;
  className?: string;
};

const SHADER_SRC: Record<string, string> = {
  "sacred-strange": "/shaders/sacred-strange.html",
  "ink-dissolve": "/shaders/ink-dissolve.html",
  "rain-on-glass": "/shaders/rain-on-glass.html",
  "silk-cascade": "/shaders/silk-cascade.html",
};

function postShaderTint(iframe: HTMLIFrameElement, tint: ComposerShaderTintColor) {
  iframe.contentWindow?.postMessage(
    {
      type: "param",
      name: "SHADER_TINT",
      value: { color: tint.value, mix: tint.mix },
    },
    "*"
  );
}

export function ComposerShaderBackground({
  shaderId,
  tintColorId,
  tintHue = 0,
  className,
}: ComposerShaderBackgroundProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const src = SHADER_SRC[shaderId];
  const tint = resolveShaderTintColor(tintColorId);
  const filter = resolveShaderTintFilter(tintHue);

  const applyTint = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    postShaderTint(iframe, tint);
  }, [tint]);

  useEffect(() => {
    applyTint();
  }, [applyTint, src]);

  if (!src) return null;

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title=""
      aria-hidden
      tabIndex={-1}
      loading="lazy"
      onLoad={applyTint}
      style={filter ? { filter } : undefined}
      className={cn("absolute inset-0 h-full w-full border-0 pointer-events-none", className)}
    />
  );
}
