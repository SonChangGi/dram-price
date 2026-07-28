import { useEffect, useRef, useState } from 'react';
import { LEGACY_THEME_KEYS, migrateStoredTheme, THEME_KEY, themeFromSearch, type Theme } from '@/lib/theme';
import { getCanonicalNavigation } from '@/shared-platform';
import { cn } from '@/lib/utils';

const projects = getCanonicalNavigation('dram');
const hub = projects[0]!;
const projectLinks = projects.slice(1);

function initialTheme(): Theme {
  let stored: Theme | null = null;
  try {
    stored = migrateStoredTheme(window.localStorage);
  } catch {
    // Storage is optional; query and system preferences still apply.
  }
  const requested = themeFromSearch(window.location.search);
  let preferred: Theme = 'light';
  try {
    preferred = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    // Light is the fail-safe when the system preference cannot be read.
  }
  const theme = requested ?? stored ?? preferred;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  return theme;
}

export function SharedNav() {
  const [theme, setTheme] = useState(initialTheme);
  const linksRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.classList.add('has-quant-shared-nav');
    const rail = linksRef.current;
    const active = rail?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!rail || !active || rail.scrollWidth <= rail.clientWidth) return;
    rail.scrollLeft = Math.max(0, active.offsetLeft - (rail.clientWidth - active.offsetWidth) / 2);
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    try {
      window.localStorage.setItem(THEME_KEY, next);
      LEGACY_THEME_KEYS.forEach((key) => window.localStorage.removeItem(key));
    } catch {
      // Persistence is optional; the current page theme still changes.
    }
  }

  return (
    <nav className="quant-shared-nav" aria-label="연결 프로젝트 바로가기">
      <div className="quant-shared-nav__inner">
        <a className="quant-shared-nav__brand" href={hub.url}>Quant Research Hub</a>
        <div ref={linksRef} id="project-links" className="quant-shared-nav__links" aria-label="프로젝트 목록">
          {projectLinks.map((project) => (
            <a
              key={project.id}
              className={cn('quant-shared-nav__link', project.current && 'is-active')}
              href={project.url}
              aria-current={project.current ? 'page' : undefined}
            >
              {project.label}
            </a>
          ))}
        </div>
        <button
          className="quant-shared-nav__theme"
          type="button"
          onClick={toggleTheme}
          aria-pressed={theme === 'dark'}
          aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
        >
          <span className="quant-shared-nav__theme-icon" aria-hidden="true" />
          <span className="quant-shared-nav__theme-text">{theme === 'dark' ? '라이트 모드' : '다크 모드'}</span>
        </button>
      </div>
    </nav>
  );
}
