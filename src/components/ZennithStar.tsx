import starSvg from "@/assets/zennith-star.svg";

export function ZennithStar({
  size = 48,
  animate = true,
  spin = false,
  className = "",
}: { size?: number; animate?: boolean; spin?: boolean; className?: string }) {
  const cls = [
    animate ? "animate-star-pulse" : "",
    spin ? "animate-star-spin" : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={`relative inline-block ${className}`} style={{ width: size, height: size }}>
      <img src={starSvg} alt="Zennith" className={cls} style={{ width: size, height: size }} />
    </div>
  );
}

export function ZennithLogo({ size = 36, subtitle = "NURSE", light = false }: { size?: number; subtitle?: string; light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <ZennithStar size={size} />
      <div className="leading-tight">
        <div className={`font-bold tracking-tight text-lg ${light ? "text-white" : "text-foreground"}`}>Zennith</div>
        <div className={`text-[10px] tracking-[0.2em] ${light ? "text-white/60" : "text-muted-foreground"}`}>{subtitle}</div>
      </div>
    </div>
  );
}
