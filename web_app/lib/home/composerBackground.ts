export const COMPOSER_BACKGROUND_STORAGE_KEY = "nyaya_composer_background";

export const MAX_OVERLAY_OPACITY = 80;
export const DEFAULT_OVERLAY_OPACITY = 40;
export const MAX_NOISE_OPACITY = 100;
export const DEFAULT_NOISE_OPACITY = 22;

export type ComposerBackgroundKind = "image" | "gradient" | "shader" | "solid";

export type ComposerBackgroundChoice = {
  kind: ComposerBackgroundKind;
  id: string;
};

export type ComposerBackgroundSettings = ComposerBackgroundChoice & {
  overlayOpacity: number;
  noiseOpacity: number;
  borderSpinColor1: string;
  borderSpinColor2: string;
  shaderTintColor: string;
  shaderHue: number;
  solidCustomHex: string;
};

export type ComposerShaderTintColor = {
  id: string;
  label: string;
  value: string;
  mix: number;
};

export const DEFAULT_SHADER_TINT_COLOR = "original";
export const MAX_SHADER_HUE = 360;
export const DEFAULT_SOLID_CUSTOM_HEX = "#00634B";
export const CUSTOM_SOLID_PRESET_ID = "custom";

export const COMPOSER_SHADER_TINT_COLORS: ComposerShaderTintColor[] = [
  { id: "original", label: "Original", value: "#ffffff", mix: 0 },
  { id: "brand", label: "Brand", value: "#00634B", mix: 0.55 },
  { id: "emerald", label: "Emerald", value: "#10b981", mix: 0.5 },
  { id: "teal", label: "Teal", value: "#14b8a6", mix: 0.5 },
  { id: "amber", label: "Amber", value: "#f59e0b", mix: 0.45 },
  { id: "rose", label: "Rose", value: "#f43f5e", mix: 0.5 },
  { id: "sky", label: "Sky", value: "#0ea5e9", mix: 0.5 },
  { id: "indigo", label: "Indigo", value: "#6366f1", mix: 0.55 },
  { id: "slate", label: "Slate", value: "#64748b", mix: 0.4 },
];

export type ComposerBorderSpinColor = {
  id: string;
  label: string;
  value: string;
};

export const COMPOSER_BORDER_SPIN_COLORS: ComposerBorderSpinColor[] = [
  { id: "white", label: "White", value: "#ffffff" },
  { id: "brand", label: "Brand", value: "#00634B" },
  { id: "emerald", label: "Emerald", value: "#10b981" },
  { id: "teal", label: "Teal", value: "#14b8a6" },
  { id: "amber", label: "Amber", value: "#f59e0b" },
  { id: "orange", label: "Orange", value: "#f97316" },
  { id: "rose", label: "Rose", value: "#f43f5e" },
  { id: "sky", label: "Sky", value: "#0ea5e9" },
  { id: "indigo", label: "Indigo", value: "#6366f1" },
  { id: "violet", label: "Violet", value: "#8b5cf6" },
  { id: "slate", label: "Slate", value: "#64748b" },
];

export const DEFAULT_BORDER_SPIN_COLOR = "white";

export type ComposerShaderPreset = {
  id: string;
  label: string;
  previewClassName: string;
};

export const COMPOSER_SHADER_PRESETS: ComposerShaderPreset[] = [
  {
    id: "sacred-strange",
    label: "Sacred Strange",
    previewClassName: "bg-[radial-gradient(circle_at_50%_40%,#c8956c_0%,#1a1208_55%,#0a0a0a_100%)]",
  },
  {
    id: "ink-dissolve",
    label: "Ink Dissolve",
    previewClassName: "bg-[radial-gradient(circle_at_30%_70%,#f59e0b_0%,#3d2208_45%,#0a0a0a_100%)]",
  },
  {
    id: "rain-on-glass",
    label: "Rain on Glass",
    previewClassName: "bg-[radial-gradient(circle_at_50%_80%,#ea580c_0%,#312e81_40%,#0c0a1a_100%)]",
  },
  {
    id: "silk-cascade",
    label: "Silk Cascade",
    previewClassName: "bg-[radial-gradient(circle_at_40%_30%,#d8b4fe_0%,#7c3aed_35%,#0f0518_100%)]",
  },
];

export type ComposerImagePreset = {
  id: string;
  label: string;
  src: string;
};

export type ComposerGradientPreset = {
  id: string;
  label: string;
  /** Tailwind arbitrary background class */
  className: string;
  /** Swatch preview for the picker */
  swatchClassName: string;
  /** Whether header copy should use light text */
  contentTone: "light" | "dark";
};

export const COMPOSER_IMAGE_PRESETS: ComposerImagePreset[] = [
  { id: "forest", label: "Forest", src: "/backgrounds/forest.png" },
  { id: "mountains", label: "Mountains", src: "/backgrounds/mountains.png" },
  { id: "sunrise", label: "Sunrise", src: "/backgrounds/sunrise.png" },
  { id: "zen-garden", label: "Zen garden", src: "/backgrounds/zen-garden.png" },
];

export const COMPOSER_GRADIENT_PRESETS: ComposerGradientPreset[] = [
  {
    id: "linear-emerald",
    label: "Emerald flow",
    className: "bg-linear-to-br from-emerald-700 via-emerald-600 to-teal-800",
    swatchClassName: "bg-linear-to-br from-emerald-700 via-emerald-600 to-teal-800",
    contentTone: "light",
  },
  {
    id: "linear-sunset",
    label: "Warm dawn",
    className: "bg-linear-to-r from-amber-500 via-orange-600 to-rose-700",
    swatchClassName: "bg-linear-to-r from-amber-500 via-orange-600 to-rose-700",
    contentTone: "light",
  },
  {
    id: "linear-slate",
    label: "Slate mist",
    className: "bg-linear-to-b from-slate-600 via-slate-700 to-stone-900",
    swatchClassName: "bg-linear-to-b from-slate-600 via-slate-700 to-stone-900",
    contentTone: "light",
  },
  {
    id: "radial-emerald",
    label: "Emerald glow",
    className: "bg-radial-[at_30%_20%] from-emerald-400 via-emerald-800 to-stone-950",
    swatchClassName: "bg-radial-[at_30%_20%] from-emerald-400 via-emerald-800 to-stone-950",
    contentTone: "light",
  },
  {
    id: "radial-amber",
    label: "Amber halo",
    className: "bg-radial-[at_70%_30%] from-amber-200 via-orange-700 to-stone-950",
    swatchClassName: "bg-radial-[at_70%_30%] from-amber-200 via-orange-700 to-stone-950",
    contentTone: "light",
  },
  {
    id: "radial-teal",
    label: "Deep teal",
    className: "bg-radial-[at_50%_0%] from-teal-500 via-emerald-900 to-stone-950",
    swatchClassName: "bg-radial-[at_50%_0%] from-teal-500 via-emerald-900 to-stone-950",
    contentTone: "light",
  },
  {
    id: "conic-brand",
    label: "Brand spin",
    className:
      "bg-conic-[from_180deg_at_50%_50%] from-emerald-600 via-teal-500 to-emerald-800",
    swatchClassName:
      "bg-conic-[from_180deg_at_50%_50%] from-emerald-600 via-teal-500 to-emerald-800",
    contentTone: "light",
  },
  {
    id: "conic-earth",
    label: "Earth wheel",
    className:
      "bg-conic-[from_0deg_at_50%_50%] from-amber-400 via-emerald-700 via-stone-600 to-amber-400",
    swatchClassName:
      "bg-conic-[from_0deg_at_50%_50%] from-amber-400 via-emerald-700 via-stone-600 to-amber-400",
    contentTone: "light",
  },
  {
    id: "conic-muted",
    label: "Muted ring",
    className:
      "bg-conic-[from_90deg_at_50%_50%] from-stone-300 via-stone-500 via-stone-700 to-stone-300",
    swatchClassName:
      "bg-conic-[from_90deg_at_50%_50%] from-stone-300 via-stone-500 via-stone-700 to-stone-300",
    contentTone: "dark",
  },
];

export type ComposerSolidPreset = {
  id: string;
  label: string;
  value: string;
  contentTone: "light" | "dark";
};

export const COMPOSER_SOLID_PRESETS: ComposerSolidPreset[] = [
  { id: "brand", label: "Brand", value: "#00634B", contentTone: "light" },
  { id: "emerald", label: "Emerald", value: "#10b981", contentTone: "light" },
  { id: "teal", label: "Teal", value: "#14b8a6", contentTone: "light" },
  { id: "forest", label: "Forest", value: "#064e3b", contentTone: "light" },
  { id: "slate", label: "Slate", value: "#475569", contentTone: "light" },
  { id: "charcoal", label: "Charcoal", value: "#1e293b", contentTone: "light" },
  { id: "amber", label: "Amber", value: "#f59e0b", contentTone: "dark" },
  { id: "rose", label: "Rose", value: "#f43f5e", contentTone: "light" },
  { id: "sky", label: "Sky", value: "#0ea5e9", contentTone: "light" },
  { id: "indigo", label: "Indigo", value: "#6366f1", contentTone: "light" },
  { id: "cream", label: "Cream", value: "#F8F9FA", contentTone: "dark" },
  { id: "white", label: "White", value: "#ffffff", contentTone: "dark" },
];

export const DEFAULT_COMPOSER_BACKGROUND: ComposerBackgroundSettings = {
  kind: "image",
  id: "forest",
  overlayOpacity: DEFAULT_OVERLAY_OPACITY,
  noiseOpacity: DEFAULT_NOISE_OPACITY,
  borderSpinColor1: DEFAULT_BORDER_SPIN_COLOR,
  borderSpinColor2: DEFAULT_BORDER_SPIN_COLOR,
  shaderTintColor: DEFAULT_SHADER_TINT_COLOR,
  shaderHue: 0,
  solidCustomHex: DEFAULT_SOLID_CUSTOM_HEX,
};

export type ComposerBackgroundPreset =
  | ComposerImagePreset
  | ComposerGradientPreset
  | ComposerShaderPreset
  | ComposerSolidPreset;

export function resolveComposerBackground(choice: ComposerBackgroundChoice): ComposerBackgroundPreset {
  if (choice.kind === "image") {
    return (
      COMPOSER_IMAGE_PRESETS.find((p) => p.id === choice.id) ?? COMPOSER_IMAGE_PRESETS[0]
    );
  }
  if (choice.kind === "shader") {
    return (
      COMPOSER_SHADER_PRESETS.find((p) => p.id === choice.id) ?? COMPOSER_SHADER_PRESETS[0]
    );
  }
  if (choice.kind === "solid") {
    return (
      COMPOSER_SOLID_PRESETS.find((p) => p.id === choice.id) ?? COMPOSER_SOLID_PRESETS[0]
    );
  }
  return (
    COMPOSER_GRADIENT_PRESETS.find((p) => p.id === choice.id) ??
    COMPOSER_GRADIENT_PRESETS[0]
  );
}

export function normalizeHex(input: string | undefined): string | null {
  if (!input) return null;
  let hex = input.trim();
  if (!hex.startsWith("#")) hex = `#${hex}`;
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
  return null;
}

function resolveSolidCustomHex(value: string | undefined) {
  return normalizeHex(value) ?? DEFAULT_SOLID_CUSTOM_HEX;
}

export function resolveSolidBackgroundColor(settings: ComposerBackgroundSettings) {
  if (settings.kind !== "solid") return COMPOSER_SOLID_PRESETS[0].value;
  if (settings.id === CUSTOM_SOLID_PRESET_ID) {
    return resolveSolidCustomHex(settings.solidCustomHex);
  }
  return (
    COMPOSER_SOLID_PRESETS.find((preset) => preset.id === settings.id)?.value ??
    COMPOSER_SOLID_PRESETS[0].value
  );
}

export function hexUsesLightText(hex: string) {
  const normalized = normalizeHex(hex);
  if (!normalized) return true;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.58;
}

export function resolveBorderSpinColor(id: string | undefined) {
  return (
    COMPOSER_BORDER_SPIN_COLORS.find((color) => color.id === id)?.value ??
    COMPOSER_BORDER_SPIN_COLORS[0].value
  );
}

function resolveBorderSpinColorId(id: string | undefined) {
  if (id && COMPOSER_BORDER_SPIN_COLORS.some((color) => color.id === id)) return id;
  return DEFAULT_BORDER_SPIN_COLOR;
}

export function borderSpinGradientStyle(color: string) {
  return {
    backgroundImage: `conic-gradient(at center, transparent 0%, ${color} 20%, transparent 30%)`,
  } as const;
}

export function resolveShaderTintColor(id: string | undefined) {
  return (
    COMPOSER_SHADER_TINT_COLORS.find((color) => color.id === id) ??
    COMPOSER_SHADER_TINT_COLORS[0]
  );
}

function resolveShaderTintColorId(id: string | undefined) {
  if (id && COMPOSER_SHADER_TINT_COLORS.some((color) => color.id === id)) return id;
  return DEFAULT_SHADER_TINT_COLOR;
}

function clampShaderHue(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.min(MAX_SHADER_HUE, Math.max(0, Math.round(value)));
}

export function resolveShaderTintFilter(hue: number) {
  if (!hue) return undefined;
  return `hue-rotate(${hue}deg) saturate(1.08)`;
}

function normalizeComposerBackgroundSettings(
  parsed: Partial<ComposerBackgroundSettings>
): ComposerBackgroundSettings {
  const overlayOpacity = clampOverlayOpacity(parsed.overlayOpacity);
  const noiseOpacity = clampNoiseOpacity(parsed.noiseOpacity);
  const borderSpinColor1 = resolveBorderSpinColorId(parsed.borderSpinColor1);
  const borderSpinColor2 = resolveBorderSpinColorId(parsed.borderSpinColor2);
  const shaderTintColor = resolveShaderTintColorId(parsed.shaderTintColor);
  const shaderHue = clampShaderHue(parsed.shaderHue);
  const solidCustomHex = resolveSolidCustomHex(parsed.solidCustomHex);

  const withExtras = {
    overlayOpacity,
    noiseOpacity,
    borderSpinColor1,
    borderSpinColor2,
    shaderTintColor,
    shaderHue,
    solidCustomHex,
  };

  if (parsed.kind === "image" && COMPOSER_IMAGE_PRESETS.some((p) => p.id === parsed.id)) {
    return {
      kind: "image",
      id: parsed.id!,
      ...withExtras,
    };
  }
  if (
    parsed.kind === "gradient" &&
    COMPOSER_GRADIENT_PRESETS.some((p) => p.id === parsed.id)
  ) {
    return {
      kind: "gradient",
      id: parsed.id!,
      ...withExtras,
    };
  }
  if (parsed.kind === "shader" && COMPOSER_SHADER_PRESETS.some((p) => p.id === parsed.id)) {
    return {
      kind: "shader",
      id: parsed.id!,
      ...withExtras,
    };
  }
  if (
    parsed.kind === "solid" &&
    (parsed.id === CUSTOM_SOLID_PRESET_ID ||
      COMPOSER_SOLID_PRESETS.some((preset) => preset.id === parsed.id))
  ) {
    return {
      kind: "solid",
      id: parsed.id!,
      ...withExtras,
    };
  }

  return {
    ...DEFAULT_COMPOSER_BACKGROUND,
    ...withExtras,
  };
}

export function readComposerBackgroundChoice(): ComposerBackgroundSettings {
  if (typeof window === "undefined") return DEFAULT_COMPOSER_BACKGROUND;
  try {
    const raw = localStorage.getItem(COMPOSER_BACKGROUND_STORAGE_KEY);
    if (!raw) return DEFAULT_COMPOSER_BACKGROUND;
    const parsed = JSON.parse(raw) as Partial<ComposerBackgroundSettings>;
    return normalizeComposerBackgroundSettings(parsed);
  } catch {
    /* ignore */
  }
  return DEFAULT_COMPOSER_BACKGROUND;
}

export function writeComposerBackgroundChoice(settings: ComposerBackgroundSettings) {
  localStorage.setItem(
    COMPOSER_BACKGROUND_STORAGE_KEY,
    JSON.stringify(normalizeComposerBackgroundSettings(settings))
  );
}

function clampOverlayOpacity(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return DEFAULT_OVERLAY_OPACITY;
  return Math.min(MAX_OVERLAY_OPACITY, Math.max(0, Math.round(value)));
}

function clampNoiseOpacity(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return DEFAULT_NOISE_OPACITY;
  return Math.min(MAX_NOISE_OPACITY, Math.max(0, Math.round(value)));
}

export function composerBackgroundUsesLightText(settings: ComposerBackgroundSettings) {
  if (settings.overlayOpacity >= 25) return true;
  if (settings.kind === "image" || settings.kind === "shader") return true;
  if (settings.kind === "solid") {
    if (settings.id === CUSTOM_SOLID_PRESET_ID) {
      return hexUsesLightText(settings.solidCustomHex);
    }
    const preset = COMPOSER_SOLID_PRESETS.find((p) => p.id === settings.id);
    return preset?.contentTone !== "dark";
  }
  const preset = COMPOSER_GRADIENT_PRESETS.find((p) => p.id === settings.id);
  return preset?.contentTone !== "dark";
}
