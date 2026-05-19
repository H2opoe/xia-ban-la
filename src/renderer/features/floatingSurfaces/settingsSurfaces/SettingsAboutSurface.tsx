import { useEffect, useState } from 'react';
import type { AppAboutInfo } from '../../../../shared/types';
import { FloatingMenuSurface } from '../floatingSurfaceModel';
import { DEFAULT_APP_ABOUT_INFO } from './types';

export function FloatingSettingsAboutMenu() {
  const [aboutInfo, setAboutInfo] = useState<AppAboutInfo>(DEFAULT_APP_ABOUT_INFO);

  useEffect(() => {
    void window.xiabanla.getAppAboutInfo().then(setAboutInfo);
  }, []);

  return (
    <FloatingMenuSurface className="settings-about-submenu">
      <div className="settings-about-row">作者：李俊彦</div>
      <div className="settings-about-row">
        <span>小红书：</span>
        <button className="settings-about-link" type="button" onClick={() => void window.xiabanla.openExternalLink('https://www.xiaohongshu.com/user/profile/5bed9e4201e65d00013a32bf')}>@李俊彦的导演笔记（小红书号：chasingup）</button>
      </div>
      <div className="settings-about-row">
        <span>邮箱：</span>
        <button className="settings-about-link" type="button" onClick={() => void window.xiabanla.openExternalLink('mailto:chase_li@qq.com')}>chase_li@qq.com</button>
      </div>
      <div className="settings-about-row">Version {aboutInfo.version}</div>
      <div className="settings-about-row">Copyright © {aboutInfo.currentYear} 佛山市戴胜文化传媒有限公司</div>
    </FloatingMenuSurface>
  );
}
