'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { LANG_COOKIE, translate, type Lang, type Vars } from '@/lib/i18n';

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangState>({ lang: 'id', setLang: () => undefined });

/**
 * The guest's language for everything inside. Kept in state, so switching it changes the screen
 * at once without a reload (a reload would end full screen), and in a cookie, so the server and a
 * reloaded screen agree. The QR page sets the session's own language.
 */
export function LangProvider({ lang: initial, children }: { lang: Lang; children: ReactNode }) {
  const [lang, setLang] = useState(initial);
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext).lang;
}

/** `t('Indonesian text', {vars})` in the guest's language. */
export function useT() {
  const { lang } = useContext(LangContext);
  return useCallback((text: string, vars?: Vars) => translate(lang, text, vars), [lang]);
}

/** Switches the guest's language for this screen and the ones that follow. */
export function useChooseLang() {
  const { lang, setLang } = useContext(LangContext);
  return useCallback(
    (next: Lang) => {
      document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=${60 * 60 * 6}; samesite=lax`;
      if (next !== lang) setLang(next);
    },
    [lang, setLang],
  );
}

/** ID · EN, for the guest to switch at the start of their session. */
export function LangToggle() {
  const lang = useLang();
  const choose = useChooseLang();
  return (
    <div className="g-lang" role="group" aria-label="Bahasa / Language">
      <button aria-pressed={lang === 'id'} onClick={() => choose('id')}>
        ID
      </button>
      <button aria-pressed={lang === 'en'} onClick={() => choose('en')}>
        EN
      </button>
    </div>
  );
}
