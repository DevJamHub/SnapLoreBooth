const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const ArrowRight = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const ArrowLeft = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
);

export const Check = () => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={3} aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export const Camera = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

export const Printer = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M7 9V4h10v5M7 17H4v-7h16v7h-3" />
    <path d="M7 14h10v6H7z" />
  </svg>
);

export const Phone = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden="true">
    <rect x="7" y="3" width="10" height="18" rx="2" />
    <path d="M11 18h2" />
  </svg>
);

export const Retry = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" />
  </svg>
);
