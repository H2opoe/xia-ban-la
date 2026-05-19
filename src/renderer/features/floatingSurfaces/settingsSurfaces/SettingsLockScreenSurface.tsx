import { useEffect, useState } from 'react';
import { ShieldIcon } from '../../../components/icons';
import { FloatingMenuSurface } from '../floatingSurfaceModel';

export function FloatingSettingsLockScreenMenu() {
  const [lockScreenAfterIdle, setLockScreenAfterIdle] = useState<boolean | null>(null);

  useEffect(() => {
    void window.xiabanla.getAppSettings().then((settings) => setLockScreenAfterIdle(settings.lockScreenAfterIdle));
  }, []);

  async function toggleLockScreen(enabled: boolean) {
    const settings = await window.xiabanla.setLockScreenAfterIdle(enabled);
    setLockScreenAfterIdle(settings.lockScreenAfterIdle);
  }

  return (
    <FloatingMenuSurface className="settings-lock-submenu">
      <div className="settings-lock-options">
        <button className={lockScreenAfterIdle === true ? 'selected' : ''} type="button" onClick={() => void toggleLockScreen(true)}>开启</button>
        <button className={lockScreenAfterIdle === false ? 'selected' : ''} type="button" onClick={() => void toggleLockScreen(false)}>关闭</button>
      </div>
      <p className="settings-lock-description">
        <ShieldIcon />
        <span>全屏提醒10秒内未点击，将自动熄屏保护隐私。</span>
      </p>
    </FloatingMenuSurface>
  );
}
