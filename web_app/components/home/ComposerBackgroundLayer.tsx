"use client";

import Image from "next/image";
import { ComposerShaderBackground } from "@/components/home/ComposerShaderBackground";
import {
  resolveComposerBackground,
  resolveSolidBackgroundColor,
  type ComposerBackgroundSettings,
  type ComposerGradientPreset,
  type ComposerImagePreset,
} from "@/lib/home/composerBackground";
import { cn } from "@/lib/utils";

type ComposerBackgroundLayerProps = {
  settings: ComposerBackgroundSettings;
  overlayOpacity?: number;
  noiseOpacity?: number;
  className?: string;
};

const NOISE_TEXTURE = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220">
    <filter id="n">
      <feTurbulence type="fractalNoise" baseFrequency="0.78" numOctaves="4" stitchTiles="stitch"/>
    </filter>
    <rect width="100%" height="100%" filter="url(#n)" opacity="0.55"/>
  </svg>`
)}")`;

export function ComposerBackgroundLayer({
  settings,
  overlayOpacity = 0,
  noiseOpacity = 0,
  className,
}: ComposerBackgroundLayerProps) {
  const preset = resolveComposerBackground(settings);
  const imagePreset = settings.kind === "image" ? (preset as ComposerImagePreset) : null;
  const gradientPreset =
    settings.kind === "gradient" ? (preset as ComposerGradientPreset) : null;
  const solidColor =
    settings.kind === "solid" ? resolveSolidBackgroundColor(settings) : undefined;

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <div className="absolute inset-0">
        {settings.kind === "image" && imagePreset ? (
          <Image
            src={imagePreset.src}
            alt=""
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 1024px"
            className="object-cover"
          />
        ) : settings.kind === "shader" ? (
          <ComposerShaderBackground
            shaderId={preset.id}
            tintColorId={settings.shaderTintColor}
            tintHue={settings.shaderHue}
          />
        ) : settings.kind === "solid" ? (
          <div className="absolute inset-0" style={{ backgroundColor: solidColor }} />
        ) : gradientPreset ? (
          <div className={cn("absolute inset-0", gradientPreset.className)} />
        ) : null}
      </div>

      {overlayOpacity > 0 && (
        <div
          className="absolute inset-0 bg-black"
          style={{ opacity: overlayOpacity / 100 }}
        />
      )}

      {noiseOpacity > 0 && (
        <div
          className="absolute inset-0 mix-blend-soft-light"
          style={{
            opacity: noiseOpacity / 100,
            backgroundImage: NOISE_TEXTURE,
            backgroundSize: "180px 180px",
          }}
        />
      )}
    </div>
  );
}
