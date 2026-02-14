"use client";

import * as React from "react";

function cx(...classes: Array<string | undefined | false | null>) {
  return classes.filter(Boolean).join(" ");
}

type CardProps = {
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "purple" | "green";
};

export function Card({ children, className, variant = "default" }: CardProps) {
  const glow = variant === "purple" ? "glow-p" : variant === "green" ? "glow-g" : "";
  return (
    <div className={cx("glass glass-rim glass-noise rounded-2xl p-5", glow, "transition will-change-transform", className)}>
      {children}
    </div>
  );
}

type ButtonVariant = "primary" | "ghost" | "danger";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  className?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
};

export function Button({
  variant = "primary",
  className,
  leftIcon,
  rightIcon,
  children,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold " +
    "active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15 focus-visible:ring-offset-0";

  const primary = "bg-white text-zinc-950 shadow-[0_16px_50px_rgba(0,0,0,0.55)] hover:bg-zinc-200";
  const ghost = "btn-premium ring-violet-hover text-zinc-100";
  const danger = "bg-red-600 text-white shadow-[0_16px_50px_rgba(0,0,0,0.55)] hover:bg-red-500";

  const styles = variant === "primary" ? primary : variant === "danger" ? danger : ghost;

  return (
    <button className={cx(base, styles, className)} {...props}>
      {leftIcon ? <span className="inline-flex">{leftIcon}</span> : null}
      <span>{children}</span>
      {rightIcon ? <span className="inline-flex">{rightIcon}</span> : null}
    </button>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  className?: string;
};

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      {...props}
      className={cx(
        "input-premium w-full rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500",
        "outline-none",
        className
      )}
    />
  );
}

type PillProps = {
  children: React.ReactNode;
  className?: string;
  tone?: "neutral" | "purple" | "green";
};

export function Pill({ children, className, tone = "neutral" }: PillProps) {
  const toneCls =
    tone === "purple"
      ? "border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset,0_0_40px_rgba(168,85,247,0.12)]"
      : tone === "green"
      ? "border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset,0_0_40px_rgba(34,197,94,0.10)]"
      : "border-white/10 bg-white/5";

  return (
    <span className={cx("inline-flex items-center rounded-full border px-3 py-1 text-xs text-zinc-200", toneCls, className)}>
      {children}
    </span>
  );
}

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("text-xs uppercase tracking-wider text-zinc-400", className)}>{children}</div>;
}

export function Hint({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("text-xs text-zinc-500", className)}>{children}</div>;
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("mono font-mono", className)}>{children}</div>;
}
