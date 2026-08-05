import { useWindowDimensions } from 'react-native';

import { classifyWindow, getHorizontalGutter, getOracleCardWidth } from './adaptive-layout';

export { classifyWindow, getHorizontalGutter, getOracleCardWidth } from './adaptive-layout';

export function useAdaptiveLayout() {
  const { fontScale, height, width } = useWindowDimensions();
  const windowClass = classifyWindow(width);

  return {
    fontScale,
    height,
    width,
    windowClass,
    gutter: getHorizontalGutter(width),
    oracleCardWidth: getOracleCardWidth(width),
    isRegular: windowClass === 'regular',
  } as const;
}
