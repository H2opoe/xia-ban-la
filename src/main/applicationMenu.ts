import { Menu } from 'electron';

export function registerApplicationMenu(showMenuPanel: () => void) {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '下班啦',
      submenu: [
        {
          label: '打开下班啦',
          click: showMenuPanel
        },
        { type: 'separator' },
        {
          label: '退出下班啦',
          role: 'quit'
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
