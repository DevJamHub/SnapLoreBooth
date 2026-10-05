import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Konsol · SnaploreBooth',
  // Behind a password anyway; this keeps it out of search results if a link ever leaks.
  robots: { index: false, follow: false },
};

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
