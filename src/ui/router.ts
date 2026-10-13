import { useSyncExternalStore } from 'react';

export type RouteName = 'dashboard' | 'calendario' | 'attivita' | 'finanze' | 'documenti' | 'obiettivi' | 'fisco' | 'impostazioni';

export interface Route {
  name: RouteName;
  params: URLSearchParams;
}

const NAMES: RouteName[] = ['dashboard', 'calendario', 'attivita', 'finanze', 'documenti', 'obiettivi', 'fisco', 'impostazioni'];

function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = h.split('?');
  const name = (NAMES as string[]).includes(path) ? (path as RouteName) : 'dashboard';
  return { name, params: new URLSearchParams(query) };
}

let current = parse(location.hash);
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  current = parse(location.hash);
  listeners.forEach((l) => l());
  window.scrollTo(0, 0);
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export function navigate(name: RouteName, params: Record<string, string> = {}): void {
  const q = new URLSearchParams(params).toString();
  location.hash = `#/${name === 'dashboard' ? '' : name}${q ? `?${q}` : ''}`;
}

export function href(name: RouteName, params: Record<string, string> = {}): string {
  const q = new URLSearchParams(params).toString();
  return `#/${name === 'dashboard' ? '' : name}${q ? `?${q}` : ''}`;
}
