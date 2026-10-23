/**
 * The Recruitly mark (owner, 2026-10-23; source: "Recruitly square logo.png"): a navy rounded square, a cream line
 * climbing to a green dot. Same drawing as src/app/icon.svg, which the favicons, app icons and extension icons are
 * rendered from (npm run render:icons, npm run pack:extension). Its colors are the logo's own, not theme tokens: the
 * mark looks the same in every theme. The default theme (globals.css "recruitly") is built from them.
 */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" className={className} aria-hidden="true" focusable="false">
      <rect width="128" height="128" rx="28" fill="#0e1a2b" />
      <polyline points="27.5,81 49,63 61,73 88,45" fill="none" stroke="#f4f3ef" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="93" cy="40" r="13" fill="#1f7a5c" />
    </svg>
  );
}
