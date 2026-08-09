import { Fragment, useEffect, type ReactNode } from 'react';
import { Uniwind } from 'uniwind'

// system: 跟随系统变化
// light: 固定为 light 主题
// dark: 固定为 dark 主题
// 页面目前以暖白与森林绿为主视觉，尚未为所有页面建立对应的暗色样式，
// 因此固定使用亮色，避免系统深色模式造成黑底与浅色控件混杂。
const DEFAULT_THEME: 'system' | 'light' | 'dark' = 'light'

const WebOnlyColorSchemeUpdater = function ({ children }: { children?: ReactNode }) {
  useEffect(() => {
    Uniwind.setTheme(DEFAULT_THEME);
  }, []);

  return <Fragment>
    {children}
  </Fragment>
};

export {
  WebOnlyColorSchemeUpdater,
}
