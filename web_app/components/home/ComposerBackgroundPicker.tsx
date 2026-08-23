"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Check, Droplet, ImageIcon, Palette, Sparkles } from "lucide-react";
import {
  COMPOSER_BORDER_SPIN_COLORS,
  COMPOSER_GRADIENT_PRESETS,
  COMPOSER_IMAGE_PRESETS,
  COMPOSER_SHADER_PRESETS,
  COMPOSER_SHADER_TINT_COLORS,
  COMPOSER_SOLID_PRESETS,
  CUSTOM_SOLID_PRESET_ID,
  MAX_NOISE_OPACITY,
  MAX_OVERLAY_OPACITY,
  MAX_SHADER_HUE,
  normalizeHex,
  resolveSolidBackgroundColor,
  type ComposerBackgroundChoice,
  type ComposerBackgroundSettings,
  readComposerBackgroundChoice,
  writeComposerBackgroundChoice,
} from "@/lib/home/composerBackground";
import { cn } from "@/lib/utils";
import { pressableSubtle, touchIconButtonCompact } from "@/lib/motion";

type ComposerBackgroundPickerProps = {
  value: ComposerBackgroundSettings;
  onChange: (settings: ComposerBackgroundSettings) => void;
  disabled?: boolean;
  className?: string;
};

function BorderSpinColorRow({
  label,
  selectedId,
  onSelect,
}: {
  label: string;
  selectedId: string;
  onSelect: (colorId: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium text-slate-600">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {COMPOSER_BORDER_SPIN_COLORS.map((color) => {
          const selected = selectedId === color.id;
          return (
            <button
              key={color.id}
              type="button"
              title={color.label}
              aria-label={color.label}
              aria-pressed={selected}
              onClick={() => onSelect(color.id)}
              className={cn(
                "relative h-6 w-6 rounded-full border transition-all",
                selected
                  ? "border-[#00634B] ring-2 ring-[#00634B]/25"
                  : "border-slate-200 hover:border-emerald-200"
              )}
              style={{ backgroundColor: color.value }}
            >
              {color.id === "white" && (
                <span className="absolute inset-0 rounded-full ring-1 ring-inset ring-slate-200" />
              )}
              {selected && (
                <Check className="absolute inset-0 m-auto h-3 w-3 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ShaderTintColorRow({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (colorId: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COMPOSER_SHADER_TINT_COLORS.map((color) => {
        const selected = selectedId === color.id;
        return (
          <button
            key={color.id}
            type="button"
            title={color.label}
            aria-label={color.label}
            aria-pressed={selected}
            onClick={() => onSelect(color.id)}
            className={cn(
              "relative h-6 w-6 rounded-full border transition-all",
              selected
                ? "border-[#00634B] ring-2 ring-[#00634B]/25"
                : "border-slate-200 hover:border-emerald-200"
            )}
            style={{ backgroundColor: color.value }}
          >
            {color.id === "original" && (
              <span className="absolute inset-0 rounded-full ring-1 ring-inset ring-slate-200" />
            )}
            {selected && (
              <Check className="absolute inset-0 m-auto h-3 w-3 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]" />
            )}
          </button>
        );
      })}
    </div>
  );
}

function CustomSolidColorPicker({
  value,
  selected,
  onApply,
}: {
  value: string;
  selected: boolean;
  onApply: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = (raw: string) => {
    const normalized = normalizeHex(raw);
    if (!normalized) return;
    setDraft(normalized);
    onApply(normalized);
  };

  return (
    <div
      className={cn(
        "mt-2 space-y-2 rounded-lg border p-2.5",
        selected ? "border-[#00634B] ring-2 ring-[#00634B]/15" : "border-slate-200"
      )}
    >
      <p className="text-[11px] font-semibold text-slate-800">Custom hex</p>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          aria-label="Pick a custom background color"
          onChange={(e) => commit(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-transparent p-0.5"
        />
        <input
          type="text"
          value={draft}
          spellCheck={false}
          aria-label="Custom background hex code"
          placeholder="#00634B"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(draft);
          }}
          className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 font-mono text-xs text-slate-800 outline-none focus:border-[#00634B] focus:ring-2 focus:ring-[#00634B]/15"
        />
      </div>
    </div>
  );
}

export function ComposerBackgroundPicker({
  value,
  onChange,
  disabled,
  className,
}: ComposerBackgroundPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ComposerBackgroundChoice["kind"]>(value.kind);
  const [panelPosition, setPanelPosition] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTab(value.kind);
  }, [value.kind, open]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setPanelPosition(null);
      return;
    }

    const updatePosition = () => {
      const button = buttonRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      const panelWidth = 320;
      const gap = 8;
      const viewportPadding = 12;
      const left = Math.min(
        Math.max(viewportPadding, rect.right - panelWidth),
        window.innerWidth - panelWidth - viewportPadding
      );

      const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
      const spaceAbove = rect.top - gap - viewportPadding;
      const openBelow = spaceBelow >= 240 || spaceBelow >= spaceAbove;
      const maxHeight = Math.max(
        180,
        Math.min(window.innerHeight - viewportPadding * 2, openBelow ? spaceBelow : spaceAbove)
      );
      const top = openBelow
        ? rect.bottom + gap
        : Math.max(viewportPadding, rect.top - gap - maxHeight);

      setPanelPosition({ top, left, maxHeight });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const select = (choice: ComposerBackgroundChoice) => {
    const next = { ...value, ...choice };
    onChange(next);
    writeComposerBackgroundChoice(next);
    setOpen(false);
  };

  const setOverlayOpacity = (overlayOpacity: number) => {
    const next = { ...value, overlayOpacity };
    onChange(next);
    writeComposerBackgroundChoice(next);
  };

  const setNoiseOpacity = (noiseOpacity: number) => {
    const next = { ...value, noiseOpacity };
    onChange(next);
    writeComposerBackgroundChoice(next);
  };

  const setBorderSpinColor = (key: "borderSpinColor1" | "borderSpinColor2", colorId: string) => {
    const next = { ...value, [key]: colorId };
    onChange(next);
    writeComposerBackgroundChoice(next);
  };

  const setShaderTintColor = (shaderTintColor: string) => {
    const next = { ...value, shaderTintColor };
    onChange(next);
    writeComposerBackgroundChoice(next);
  };

  const setShaderHue = (shaderHue: number) => {
    const next = { ...value, shaderHue };
    onChange(next);
    writeComposerBackgroundChoice(next);
  };

  const applySolidCustom = (solidCustomHex: string) => {
    const normalized = normalizeHex(solidCustomHex);
    if (!normalized) return;
    const next = {
      ...value,
      kind: "solid" as const,
      id: CUSTOM_SOLID_PRESET_ID,
      solidCustomHex: normalized,
    };
    onChange(next);
    writeComposerBackgroundChoice(next);
  };

  const showShaderControls = tab === "shader" || value.kind === "shader";
  const solidCustomColor = resolveSolidBackgroundColor({
    ...value,
    kind: "solid",
    id: CUSTOM_SOLID_PRESET_ID,
  });

  return (
    <div ref={rootRef} className={cn("absolute right-2 top-2 z-20", className)}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="Change composer background"
        aria-expanded={open}
        className={cn(
          pressableSubtle,
          touchIconButtonCompact,
          "rounded-lg border border-white/60 bg-white/80 text-slate-600 shadow-sm backdrop-blur-sm hover:border-emerald-200 hover:bg-white hover:text-[#00634B] disabled:opacity-40"
        )}
      >
        <Palette className="h-4 w-4" />
      </button>

      {open &&
        panelPosition &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              top: panelPosition.top,
              left: panelPosition.left,
              maxHeight: panelPosition.maxHeight,
            }}
            className="fixed z-[120] w-80 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 shadow-xl motion-enter-fade custom-scrollbar"
          >
          <p className="mb-2 text-xs font-semibold text-slate-800">Page background</p>

          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="composer-overlay-opacity" className="text-[11px] font-medium text-slate-600">
                Dark overlay
              </label>
              <span className="text-[11px] font-semibold tabular-nums text-slate-800">
                {value.overlayOpacity}%
              </span>
            </div>
            <input
              id="composer-overlay-opacity"
              type="range"
              min={0}
              max={MAX_OVERLAY_OPACITY}
              step={1}
              value={value.overlayOpacity}
              onChange={(e) => setOverlayOpacity(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-[#00634B]"
            />
          </div>

          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="composer-noise-opacity" className="text-[11px] font-medium text-slate-600">
                Background noise
              </label>
              <span className="text-[11px] font-semibold tabular-nums text-slate-800">
                {value.noiseOpacity}%
              </span>
            </div>
            <input
              id="composer-noise-opacity"
              type="range"
              min={0}
              max={MAX_NOISE_OPACITY}
              step={1}
              value={value.noiseOpacity}
              onChange={(e) => setNoiseOpacity(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-[#00634B]"
            />
          </div>

          <div className="mb-3 space-y-2.5 rounded-lg border border-slate-200 p-2.5">
            <p className="text-[11px] font-semibold text-slate-800">Input border glow</p>
            <BorderSpinColorRow
              label="First spin"
              selectedId={value.borderSpinColor1}
              onSelect={(colorId) => setBorderSpinColor("borderSpinColor1", colorId)}
            />
            <BorderSpinColorRow
              label="Second spin"
              selectedId={value.borderSpinColor2}
              onSelect={(colorId) => setBorderSpinColor("borderSpinColor2", colorId)}
            />
          </div>

          {showShaderControls && (
            <div className="mb-3 space-y-2.5 rounded-lg border border-slate-200 p-2.5">
              <p className="text-[11px] font-semibold text-slate-800">Shader color</p>
              <ShaderTintColorRow
                selectedId={value.shaderTintColor}
                onSelect={setShaderTintColor}
              />
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="composer-shader-hue" className="text-[11px] font-medium text-slate-600">
                    Hue shift
                  </label>
                  <span className="text-[11px] font-semibold tabular-nums text-slate-800">
                    {value.shaderHue}°
                  </span>
                </div>
                <input
                  id="composer-shader-hue"
                  type="range"
                  min={0}
                  max={MAX_SHADER_HUE}
                  step={1}
                  value={value.shaderHue}
                  onChange={(e) => setShaderHue(Number(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-[#00634B]"
                />
              </div>
            </div>
          )}

          <div className="mb-3 grid grid-cols-4 gap-0.5 rounded-lg border border-slate-200 p-0.5">
            <button
              type="button"
              onClick={() => setTab("image")}
              className={cn(
                "flex items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors",
                tab === "image"
                  ? "bg-emerald-50 text-[#00634B]"
                  : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <ImageIcon className="h-3.5 w-3.5 shrink-0" />
              Photos
            </button>
            <button
              type="button"
              onClick={() => setTab("gradient")}
              className={cn(
                "flex items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors",
                tab === "gradient"
                  ? "bg-emerald-50 text-[#00634B]"
                  : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <Palette className="h-3.5 w-3.5 shrink-0" />
              Gradients
            </button>
            <button
              type="button"
              onClick={() => setTab("solid")}
              className={cn(
                "flex items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors",
                tab === "solid"
                  ? "bg-emerald-50 text-[#00634B]"
                  : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <Droplet className="h-3.5 w-3.5 shrink-0" />
              Solid
            </button>
            <button
              type="button"
              onClick={() => setTab("shader")}
              className={cn(
                "flex items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors",
                tab === "shader"
                  ? "bg-emerald-50 text-[#00634B]"
                  : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              Shaders
            </button>
          </div>

          {tab === "image" ? (
            <div className="grid grid-cols-2 gap-2">
              {COMPOSER_IMAGE_PRESETS.map((preset) => {
                const selected = value.kind === "image" && value.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => select({ kind: "image", id: preset.id })}
                    className={cn(
                      "group relative overflow-hidden rounded-lg border text-left transition-all",
                      selected
                        ? "border-[#00634B] ring-2 ring-[#00634B]/20"
                        : "border-slate-200 hover:border-emerald-200"
                    )}
                  >
                    <div className="relative aspect-[4/3] w-full">
                      <Image
                        src={preset.src}
                        alt=""
                        fill
                        sizes="128px"
                        className="object-cover"
                      />
                      {selected && (
                        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#00634B] text-white">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                    <span className="block px-2 py-1.5 text-[11px] font-medium text-slate-700">
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : tab === "solid" ? (
            <>
              <div className="grid grid-cols-4 gap-2">
                {COMPOSER_SOLID_PRESETS.map((preset) => {
                  const selected = value.kind === "solid" && value.id === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.label}
                      onClick={() => select({ kind: "solid", id: preset.id })}
                      className={cn(
                        "group relative aspect-square overflow-hidden rounded-lg border transition-all",
                        selected
                          ? "border-[#00634B] ring-2 ring-[#00634B]/20"
                          : "border-slate-200 hover:border-emerald-200"
                      )}
                    >
                      <div
                        className="absolute inset-0"
                        style={{ backgroundColor: preset.value }}
                      />
                      {preset.id === "white" && (
                        <span className="absolute inset-0 ring-1 ring-inset ring-slate-200" />
                      )}
                      {selected && (
                        <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#00634B] text-white">
                          <Check className="h-2.5 w-2.5" />
                        </span>
                      )}
                      <span className="absolute inset-x-0 bottom-0 bg-black/45 px-1 py-0.5 text-[9px] font-medium leading-tight text-white">
                        {preset.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              <CustomSolidColorPicker
                value={solidCustomColor}
                selected={value.kind === "solid" && value.id === CUSTOM_SOLID_PRESET_ID}
                onApply={applySolidCustom}
              />
            </>
          ) : tab === "gradient" ? (
            <div className="grid grid-cols-3 gap-2">
              {COMPOSER_GRADIENT_PRESETS.map((preset) => {
                const selected = value.kind === "gradient" && value.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.label}
                    onClick={() => select({ kind: "gradient", id: preset.id })}
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-lg border transition-all",
                      selected
                        ? "border-[#00634B] ring-2 ring-[#00634B]/20"
                        : "border-slate-200 hover:border-emerald-200"
                    )}
                  >
                    <div className={cn("absolute inset-0", preset.swatchClassName)} />
                    {selected && (
                      <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#00634B] text-white">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                    )}
                    <span className="absolute inset-x-0 bottom-0 bg-black/45 px-1 py-0.5 text-[9px] font-medium leading-tight text-white">
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {COMPOSER_SHADER_PRESETS.map((preset) => {
                const selected = value.kind === "shader" && value.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => select({ kind: "shader", id: preset.id })}
                    className={cn(
                      "group relative overflow-hidden rounded-lg border text-left transition-all",
                      selected
                        ? "border-[#00634B] ring-2 ring-[#00634B]/20"
                        : "border-slate-200 hover:border-emerald-200"
                    )}
                  >
                    <div className={cn("aspect-[4/3] w-full", preset.previewClassName)} />
                    {selected && (
                      <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#00634B] text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                    <span className="block px-2 py-1.5 text-[11px] font-medium text-slate-700">
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          </div>,
          document.body
        )}
    </div>
  );
}

export function useComposerBackgroundChoice() {
  const [settings, setSettings] = useState<ComposerBackgroundSettings>(() =>
    readComposerBackgroundChoice()
  );

  useEffect(() => {
    setSettings(readComposerBackgroundChoice());
  }, []);

  return [settings, setSettings] as const;
}
