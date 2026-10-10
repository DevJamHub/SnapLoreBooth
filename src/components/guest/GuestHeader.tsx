'use client';

import type { ReactNode } from 'react';
import { useT } from '@/components/guest/lang';

export type StepId = 'pilih' | 'hias' | 'bayar' | 'foto' | 'gaya' | 'cetak';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'pilih', label: 'Pilih' },
  { id: 'hias', label: 'Hias' },
  { id: 'bayar', label: 'Bayar' },
  { id: 'foto', label: 'Foto' },
  { id: 'gaya', label: 'Gaya' },
  { id: 'cetak', label: 'Cetak' },
];

export function Logo() {
  return (
    <span className="g-logo">
      Snaplore<span>Booth</span>
    </span>
  );
}

/** Where the guest is in the flow; the payment step disappears when the booth is free. */
export function Steps({ current, payments }: { current: StepId; payments: boolean }) {
  const t = useT();
  const steps = STEPS.filter((s) => payments || s.id !== 'bayar');
  const at = steps.findIndex((s) => s.id === current);
  return (
    <nav className="g-steps" aria-label={t('Langkah')}>
      {steps.map((step, i) => (
        <span key={step.id} style={{ display: 'contents' }}>
          {i > 0 && <span className="g-step-line" />}
          <span className="g-step" data-state={i < at ? 'done' : i === at ? 'current' : 'todo'}>
            <i>{i < at ? '✓' : i + 1}</i>
            <b style={{ fontWeight: 'inherit' }}>{t(step.label)}</b>
          </span>
        </span>
      ))}
    </nav>
  );
}

export default function GuestHeader({
  step,
  payments,
  left,
  right,
}: {
  step: StepId;
  payments: boolean;
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="g-header">
      <div className="g-header-side">{left ?? <Logo />}</div>
      <Steps current={step} payments={payments} />
      <div className="g-header-side">{right}</div>
    </header>
  );
}
