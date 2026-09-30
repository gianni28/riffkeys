/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        stage: "#15161d",
        surface: "#1b1c25",
        raised: "#23242f",
        line: "#30323f",
        ink: "#ecebf2",
        muted: "#9d9eb2",
        bone: "#f3f0e8",
        rh: "#6b93ff",
        lh: "#ff9a4d",
        danger: "#ff6b6b",
      },
      fontFamily: {
        display: ['"Big Shoulders Display"', "Impact", '"Arial Narrow"', "sans-serif"],
        sans: ['"Figtree Variable"', "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
        mono: ['ui-monospace', "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
