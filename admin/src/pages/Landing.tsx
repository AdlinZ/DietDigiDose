import { useEffect, useRef } from 'react';
import api from '../services/api';
import markup from './landing/markup.html?raw';
import { initializeLanding } from './landing/initialize';
import './Landing.css';

/** The approved editorial homepage is a self-contained, bundled static template.
 * Only its small demo mutates this subtree; React owns mounting and cleanup.
 * Never replace this import with API-provided or user-authored HTML.
 */
export default function Landing() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    // Reset on StrictMode re-mount, so marquee copies and demo state do not leak.
    root.innerHTML = markup;
    const cleanup = initializeLanding(root);
    let active = true;
    const previousTitle = document.title;
    document.title = '食光烙记｜把日常，做成好好的一餐';
    root.querySelector('#copyrightYear')!.textContent = String(new Date().getFullYear());
    api.get('/site-settings').then(({ data }) => {
      if (!active || !data?.filing?.enabled || !data.filing.text) return;
      const filing = data.filing;
      const slot = root.querySelector('#siteFiling')!;
      // Preserve server-configured filing text, without treating it as HTML.
      let safeUrl: URL | null = null;
      try {
        const url = new URL(filing.url);
        if (url.protocol === 'https:' || url.protocol === 'http:') safeUrl = url;
      } catch { /* A missing or malformed URL renders as plain text. */ }
      if (safeUrl) {
        const link = document.createElement('a');
        link.href = safeUrl.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = filing.text;
        slot.replaceChildren(link);
      } else slot.textContent = filing.text;
    }).catch(() => undefined);
    return () => {
      active = false;
      cleanup();
      document.title = previousTitle;
    };
  }, []);
  return <div ref={host} className="landing-homepage" />;
}
