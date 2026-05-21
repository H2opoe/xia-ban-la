import type { MenuFloatingSurfaceKind, ThemeMode } from '../../shared/types';
import { MENU_PANEL_SIZE, MENU_SURFACE_OUTSET } from '../../shared/window';
import { ReminderOverlay } from '../components/ReminderOverlay';
import { FloatingSurfaceApp } from '../features/floatingSurfaces/FloatingSurfaceApp';
import { SettingsApp } from '../features/menuPanel/MenuPanel';
import { createDemoReminderPayload } from './demoData';
import './demo-screenshot.css';

type DemoScreenshotSceneProps = {
  params: URLSearchParams;
};

type SurfaceConfig = {
  kind: MenuFloatingSurfaceKind;
  reminderId?: string;
  width: number;
  top?: number;
};

export function DemoScreenshotScene(props: DemoScreenshotSceneProps) {
  const theme = getDemoTheme(props.params);
  const surface = getSurfaceConfig(props.params.get('surface'));
  const isReminder = props.params.get('scene') === 'reminder';
  const className = ['demo-screenshot-scene', theme === 'dark' ? 'demo-screenshot-dark' : ''].filter(Boolean).join(' ');

  if (isReminder) {
    return (
      <main className={className}>
        <DemoDesktopChrome />
        <ReminderOverlay payload={createDemoReminderPayload()} />
      </main>
    );
  }

  return (
    <main className={className}>
      <DemoDesktopChrome />
      <section className="demo-capture-stage">
        <div className="demo-main-panel">
          <SettingsApp />
        </div>
        {surface && (
          <div
            className="demo-secondary-surface"
            style={{
              ['--demo-secondary-width' as string]: `${surface.width}px`,
              ['--demo-secondary-top' as string]: `${surface.top ?? MENU_SURFACE_OUTSET}px`
            }}
          >
            <FloatingSurfaceApp
              route={{
                kind: surface.kind,
                reminderId: surface.reminderId
              }}
            />
          </div>
        )}
      </section>
    </main>
  );
}

function DemoDesktopChrome() {
  return (
    <>
      <div className="demo-desktop-menu-bar">
        <span>下班啦</span>
        <span>文件</span>
        <span>编辑</span>
        <span>窗口</span>
        <time>周四 10:18</time>
      </div>
      <div className="demo-desktop-dock" aria-hidden="true">
        {Array.from({ length: 8 }).map((_, index) => <span key={index} />)}
      </div>
    </>
  );
}

function getDemoTheme(params: URLSearchParams): ThemeMode {
  const theme = params.get('theme');
  return theme === 'dark' ? 'dark' : 'light';
}

function getSurfaceConfig(surfaceName: string | null): SurfaceConfig | null {
  switch (surfaceName) {
    case 'settings':
      return { kind: 'settings', width: 216 };
    case 'appearance':
      return { kind: 'settings-theme', width: 112, top: 116 };
    case 'countdown':
      return { kind: 'settings-lock-screen', width: 300, top: 116 };
    case 'repeat':
      return { kind: 'reminder-repeat', reminderId: 'demo-alternate-week-report', width: 360, top: 264 };
    default:
      return null;
  }
}

export const DEMO_SCREENSHOT_VIEWPORT = {
  width: MENU_PANEL_SIZE.width + MENU_SURFACE_OUTSET * 2,
  height: MENU_PANEL_SIZE.height + MENU_SURFACE_OUTSET * 2
};
