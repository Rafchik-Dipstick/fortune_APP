export function shouldReduceMotion(
  systemReduceMotion: boolean,
  reduceMoreMotion: boolean,
): boolean {
  return systemReduceMotion || reduceMoreMotion;
}
