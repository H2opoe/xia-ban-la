import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { MenuFloatingSurfaceKind } from '../shared/types';
import { MENU_PANEL_SIZE, MENU_SURFACE_OUTSET } from '../shared/window';
import { ReminderOverlay } from './components/ReminderOverlay';
import { FloatingSurfaceApp } from './features/floatingSurfaces/FloatingSurfaceApp';
import { SettingsApp } from './features/menuPanel/MenuPanel';
import './styles.css';

type FloatingRoute = {
  kind: MenuFloatingSurfaceKind;
  reminderId?: string;
  restoreTitle?: string;
};

function App() {
  const [routeHash, setRouteHash] = useState(() => window.location.hash);
  const isReminderRoute = routeHash === '#/reminder';
  const floatingRoute = getFloatingRoute(routeHash);

  useEffect(() => {
    function updateRouteHash() {
      setRouteHash(window.location.hash);
    }

    window.addEventListener('hashchange', updateRouteHash);
    return () => window.removeEventListener('hashchange', updateRouteHash);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('menu-preview-route', !isReminderRoute && !floatingRoute);
    document.body.classList.toggle('menu-floating-route', Boolean(floatingRoute));
    document.body.style.setProperty('--menu-panel-width', `${MENU_PANEL_SIZE.width}px`);
    document.body.style.setProperty('--menu-panel-height', `${MENU_PANEL_SIZE.height}px`);
    document.body.style.setProperty('--surface-outset', `${MENU_SURFACE_OUTSET}px`);

    return () => {
      document.body.classList.remove('menu-preview-route');
      document.body.classList.remove('menu-floating-route');
      document.body.style.removeProperty('--menu-panel-width');
      document.body.style.removeProperty('--menu-panel-height');
      document.body.style.removeProperty('--surface-outset');
    };
  }, [floatingRoute, isReminderRoute]);

  if (isReminderRoute) {
    return <ReminderOverlay />;
  }

  if (floatingRoute) {
    return <FloatingSurfaceApp route={floatingRoute} />;
  }

  return <SettingsApp />;
}

function getFloatingRoute(routeHash: string): FloatingRoute | null {
  const match = /^#\/floating\/([^?]+)(?:\?(.*))?$/.exec(routeHash);
  if (!match) {
    return null;
  }

  const kind = match[1] as MenuFloatingSurfaceKind;
  const params = new URLSearchParams(match[2] || '');
  return {
    kind,
    reminderId: params.get('reminderId') || undefined,
    restoreTitle: params.get('restoreTitle') ?? undefined
  };
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
