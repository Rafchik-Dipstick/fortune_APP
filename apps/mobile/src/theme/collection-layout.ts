import { layout } from './tokens';

export interface CollectionGridLayout {
  cellWidth: number;
  columns: number;
  gap: number;
}

const minimumCellWidth = 104;
const maximumCellWidth = 180;
const cellGap = 12;

/**
 * Sizes the deck grid from available width and a minimum card cell width, so
 * column count adapts continuously instead of switching on device names.
 */
export function getCollectionGridLayout(windowWidth: number, gutter: number): CollectionGridLayout {
  const available = Math.max(Math.min(windowWidth, layout.contentMax) - gutter * 2, 208);
  const columns = Math.max(2, Math.floor((available + cellGap) / (minimumCellWidth + cellGap)));
  const cellWidth = Math.min(
    Math.floor((available - cellGap * (columns - 1)) / columns),
    maximumCellWidth,
  );
  return { cellWidth, columns, gap: cellGap };
}
