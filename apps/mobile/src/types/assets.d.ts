declare module '*.png' {
  const source: import('react-native').ImageSourcePropType;
  export default source;
}

declare module '*.wav' {
  const source: number;
  export default source;
}
