import type { CSSProperties } from "react";

type Props = {
  className?: string;
  size?: number;
};

/** Shared MCW logo mark used in headers / sidebar. */
export function BrandMark({ className = "", size }: Props) {
  const style: CSSProperties | undefined = size
    ? { width: size, height: size }
    : undefined;

  return (
    <img
      src="/mcw-logo.png"
      alt=""
      aria-hidden="true"
      className={`brand-mark ${className}`.trim()}
      style={style}
      width={size ?? 36}
      height={size ?? 36}
      decoding="async"
    />
  );
}
