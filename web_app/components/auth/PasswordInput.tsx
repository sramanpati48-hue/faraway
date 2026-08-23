"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { authFieldWithIconClass } from "@/lib/auth/formStyles";
import { focusRing, pressableSubtle } from "@/lib/motion";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Auth pages use lock icon + emerald focus styles. */
  variant?: "auth" | "plain" | "admin";
  /** Wrapper class (e.g. `mt-1` on login labels). */
  wrapperClassName?: string;
  inputClassName?: string;
  showLockIcon?: boolean;
};

const variantInputClass: Record<NonNullable<PasswordInputProps["variant"]>, string> = {
  auth: cn(authFieldWithIconClass, "pr-11"),
  plain:
    "w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 pr-11 text-base text-gray-900 outline-none transition-[border-color,box-shadow] focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20",
  admin: "pr-11",
};

const toggleClass: Record<NonNullable<PasswordInputProps["variant"]>, string> = {
  auth: "text-slate-400 hover:text-slate-600",
  plain: "text-gray-400 hover:text-gray-600",
  admin: "text-white/45 hover:text-white/80",
};

export function PasswordInput({
  variant = "auth",
  wrapperClassName,
  inputClassName,
  showLockIcon,
  className,
  id: idProp,
  disabled,
  ...props
}: PasswordInputProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const [visible, setVisible] = useState(false);
  const withLock = showLockIcon ?? variant === "auth";

  return (
    <div className={cn("relative", wrapperClassName, className)}>
      {withLock ? (
        <Lock
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
      ) : null}
      <input
        {...props}
        id={id}
        type={visible ? "text" : "password"}
        disabled={disabled}
        className={cn(variantInputClass[variant], inputClassName)}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        aria-controls={id}
        disabled={disabled}
        onClick={() => setVisible((v) => !v)}
        className={cn(
          "absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg transition-colors",
          toggleClass[variant],
          focusRing,
          pressableSubtle,
          disabled && "pointer-events-none opacity-40"
        )}
      >
        {visible ? (
          <EyeOff className="h-4 w-4" aria-hidden />
        ) : (
          <Eye className="h-4 w-4" aria-hidden />
        )}
      </button>
    </div>
  );
}