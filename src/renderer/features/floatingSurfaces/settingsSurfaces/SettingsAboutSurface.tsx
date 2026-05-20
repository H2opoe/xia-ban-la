import { useEffect, useState } from 'react';
import type { AppAboutInfo } from '../../../../shared/types';
import { FloatingMenuSurface } from '../floatingSurfaceModel';
import { DEFAULT_APP_ABOUT_INFO } from './types';

const WECHAT_GROUP_URL = 'https://u.wechat.com/EDsLZ6LQyemJxtrM-PlvT-k?s=3';
const wechatGroupQrCodeUrl = new URL('../../../assets/about-wechat-group.svg', import.meta.url).href;
const wechatGroupQrCodeDarkUrl = new URL('../../../assets/about-wechat-group-dark.svg', import.meta.url).href;
const wechatLogoUrl = new URL('../../../assets/about-wechat-logo.png', import.meta.url).href;

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
      <div className="settings-about-divider" aria-hidden="true" />
      <div className="settings-about-community">
        <p>添加作者入群，接收更新或反馈。</p>
        <button className="settings-about-qr-button" type="button" onClick={() => void window.xiabanla.openExternalLink(WECHAT_GROUP_URL)}>
          <img className="settings-about-qr-image settings-about-qr-image-light" src={wechatGroupQrCodeUrl} alt="添加作者进软件群二维码" />
          <img className="settings-about-qr-image settings-about-qr-image-dark" src={wechatGroupQrCodeDarkUrl} alt="" aria-hidden="true" />
          <img className="settings-about-qr-logo" src={wechatLogoUrl} alt="" aria-hidden="true" />
        </button>
      </div>
    </FloatingMenuSurface>
  );
}
