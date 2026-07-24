import { ExternalLink, Menu, Moon, Sun, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { LEGACY_THEME_KEYS, migrateStoredTheme, THEME_KEY, themeFromSearch, type Theme } from '@/lib/theme';
import { getCanonicalNavigation } from '@/shared-platform';
import { cn } from '@/lib/utils';

const projects = getCanonicalNavigation('dram');

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
  return theme;
}

export function SharedNav() {
  const [theme, setTheme] = useState(initialTheme);
  const [open, setOpen] = useState(false);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_KEY, next);
      LEGACY_THEME_KEYS.forEach((key) => window.localStorage.removeItem(key));
    } catch {
      // Persistence is optional; the current page theme still changes.
    }
  }

  return (
    <nav className="shared-nav" aria-label="11개 퀀트 리서치 프로젝트">
      <a className="shared-nav__brand" href={projects[0]!.url}>Quant Research</a>
      <Button
        className="shared-nav__menu"
        size="icon"
        variant="ghost"
        aria-expanded={open}
        aria-controls="project-links"
        aria-label={open ? '프로젝트 메뉴 닫기' : '프로젝트 메뉴 열기'}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </Button>
      <div id="project-links" className={cn('shared-nav__links', open && 'is-open')}>
        {projects.map((project) => (
          <a
            key={project.id}
            className={cn(project.current && 'is-active')}
            href={project.url}
            aria-current={project.current ? 'page' : undefined}
            onClick={() => setOpen(false)}
          >
            {project.label}
          </a>
        ))}
      </div>
      <Button size="icon" variant="ghost" onClick={toggleTheme} aria-pressed={theme === 'dark'} aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}>
        {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      </Button>
      <a className="shared-nav__external" href={projects[0]!.url} aria-label="통합 허브 열기">
        <ExternalLink aria-hidden="true" />
      </a>
    </nav>
  );
}
