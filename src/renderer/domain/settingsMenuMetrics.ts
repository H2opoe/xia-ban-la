import type { AppAboutInfo } from '../../shared/types';
import { clampNumber } from '../utils/dom';

const SETTINGS_TERTIARY_MENU_WIDTH = 210;
const SETTINGS_ABOUT_MENU_MIN_WIDTH = SETTINGS_TERTIARY_MENU_WIDTH;
const SETTINGS_ABOUT_MENU_MAX_WIDTH = 520;
const SETTINGS_ABOUT_MENU_HORIZONTAL_PADDING = 20;

export function getSettingsAboutMenuWidth(aboutInfo: AppAboutInfo) {
  const rows = [
    '作者：李俊彦',
    '小红书：@李俊彦的导演笔记（小红书号：chasingup）',
    '邮箱：chase_li@qq.com',
    `Version ${aboutInfo.version}`,
    `Copyright © ${aboutInfo.currentYear} 佛山市戴胜文化传媒有限公司`
  ];
  const textWidth = measureMenuTextWidth(rows);
  return Math.ceil(clampNumber(
    textWidth + SETTINGS_ABOUT_MENU_HORIZONTAL_PADDING,
    SETTINGS_ABOUT_MENU_MIN_WIDTH,
    SETTINGS_ABOUT_MENU_MAX_WIDTH
  ));
}

function measureMenuTextWidth(values: string[]) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return SETTINGS_ABOUT_MENU_MIN_WIDTH;
  }

  // Electron 需要在创建浮层窗口前确定尺寸，所以这里按菜单字体预估“关于软件”的内容宽度。
  context.font = '12px Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  return values.reduce((maxWidth, value) => Math.max(maxWidth, context.measureText(value).width), 0);
}
