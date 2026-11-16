// Vitest (Vite) loads a fixture as text with `?raw`.
declare module '*.pgn?raw' {
  const text: string;
  export default text;
}
