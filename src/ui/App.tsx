import { useEffect } from 'react';
import { ActivityForm } from './ActivityForm';
import { AppProvider } from './context';
import { useAppData } from './data';
import { DrillSheet } from './DrillSheet';
import { Activities } from './pages/Activities';
import { Calendar } from './pages/Calendar';
import { Dashboard } from './pages/Dashboard';
import { Documents } from './pages/Documents';
import { Finance } from './pages/Finance';
import { Goals } from './pages/Goals';
import { Settings } from './pages/Settings';
import { Fiscal } from './pages/Fiscal';
import { href, useRoute, type RouteName } from './router';
import { useApp } from './context';
import { useCalendarAutoSync, useDriveAutoSync } from '../sync/driveSync';
import { trySilentReconnect } from '../sync/drive';

const NAV: { name: RouteName; label: string; icon: string; primary: boolean }[] = [
  { name: 'dashboard', label: 'Home', icon: '⌂', primary: true },
  { name: 'calendario', label: 'Calendario', icon: '▦', primary: true },
  { name: 'attivita', label: 'Attività', icon: '☰', primary: true },
  { name: 'finanze', label: 'Finanze', icon: '€', primary: true },
  { name: 'documenti', label: 'Documenti', icon: '▤', primary: false },
  { name: 'obiettivi', label: 'Obiettivi', icon: '◎', primary: false },
  { name: 'fisco', label: 'Fisco', icon: '%', primary: false },
  { name: 'impostazioni', label: 'Impostazioni', icon: '⚙', primary: false },
];

function Page() {
  const route = useRoute();
  switch (route.name) {
    case 'calendario':
      return <Calendar />;
    case 'attivita':
      return <Activities />;
    case 'finanze':
      return <Finance />;
    case 'documenti':
      return <Documents />;
    case 'obiettivi':
      return <Goals />;
    case 'fisco':
      return <Fiscal />;
    case 'impostazioni':
      return <Settings />;
    default:
      return <Dashboard />;
  }
}

function Shell() {
  const route = useRoute();
  const { openActivity, data } = useApp();
  useDriveAutoSync(data);
  useCalendarAutoSync(data);
  // Tornando nell'app dopo più di un'ora l'accesso Google è scaduto: lo rinnova da solo.
  const googleOn = data.settings.driveSync || data.settings.calendarSync;
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && trySilentReconnect(googleOn);
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [googleOn]);
  const secondaryActive = NAV.some((n) => !n.primary && n.name === route.name);
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Sezioni">
        <div className="brand">SkiWork</div>
        {NAV.map((n) => (
          <a key={n.name} href={href(n.name)} className={route.name === n.name ? 'active' : ''} aria-current={route.name === n.name ? 'page' : undefined}>
            <span aria-hidden className="nav-icon">
              {n.icon}
            </span>
            {n.label}
          </a>
        ))}
      </nav>
      <main className="main">
        <Page />
      </main>
      <button className="fab" onClick={() => openActivity()} aria-label="Aggiungi attività">
        <span aria-hidden>+</span>
        <span className="fab-label">Aggiungi attività</span>
      </button>
      <nav className="tabbar" aria-label="Sezioni principali">
        {NAV.filter((n) => n.primary).map((n) => (
          <a key={n.name} href={href(n.name)} className={route.name === n.name ? 'active' : ''} aria-current={route.name === n.name ? 'page' : undefined}>
            <span aria-hidden className="nav-icon">
              {n.icon}
            </span>
            <span>{n.label}</span>
          </a>
        ))}
        <details className={`more${secondaryActive ? ' active' : ''}`}>
          <summary>
            <span aria-hidden className="nav-icon">
              ⋯
            </span>
            <span>Altro</span>
          </summary>
          <div className="more-menu">
            {NAV.filter((n) => !n.primary).map((n) => (
              <a
                key={n.name}
                href={href(n.name)}
                onClick={(e) => (e.currentTarget.closest('details') as HTMLDetailsElement).removeAttribute('open')}
                className={route.name === n.name ? 'active' : ''}
              >
                {n.icon} {n.label}
              </a>
            ))}
          </div>
        </details>
      </nav>
    </div>
  );
}

export function App() {
  const data = useAppData();

  useEffect(() => {
    if (!data) return;
    const root = document.documentElement;
    if (data.settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', data.settings.theme);
  }, [data?.settings.theme, data]);

  if (!data) return <div className="loading">Caricamento…</div>;

  return (
    <AppProvider data={data} renderDrill={(spec, close) => <DrillSheet spec={spec} onClose={close} />} renderActivityForm={(req, close) => <ActivityForm req={req} onClose={close} />}>
      <Shell />
    </AppProvider>
  );
}
