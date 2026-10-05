'use client';

import { useState } from 'react';

/** Copies a link for the operator to paste into a chat; falls back to selecting it. */
export default function CopyButton({ text, label = 'Salin link' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Salin link ini:', text);
    }
  };

  return (
    <button className="pill pill-ghost pill-sm" onClick={copy}>
      {copied ? 'Tersalin ✓' : label}
    </button>
  );
}
