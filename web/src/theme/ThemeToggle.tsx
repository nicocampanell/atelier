import { useTheme } from './useTheme';
import './theme.css';

const RAYS = [0, 45, 90, 135, 180, 225, 270, 315];

/** Sun <-> moon: the rays fold away while a masked disc grows a bite. Driven by aria-pressed in theme.css. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={dark}
      onClick={toggle}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
        <mask id="theme-moon-mask">
          <rect width="24" height="24" fill="#fff" />
          <circle className="theme-toggle__bite" cx="28" cy="0" r="8" fill="#000" />
        </mask>
        <circle className="theme-toggle__disc" cx="12" cy="12" r="5" fill="currentColor" mask="url(#theme-moon-mask)" />
        <g className="theme-toggle__rays" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          {RAYS.map((a) => (
            <line key={a} x1="12" y1="2.5" x2="12" y2="4.5" transform={`rotate(${a} 12 12)`} />
          ))}
        </g>
      </svg>
    </button>
  );
}
