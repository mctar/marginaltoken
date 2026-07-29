/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#FFF1E5',
        'paper-deep': '#FCEDE0',
        ink: '#2B2A28',
        'ink-muted': '#6B645E',
        'ink-faint': '#A39A91',
        teal: '#0D7680',
        claret: '#990F3D',
        blue: '#0F5499',
      },
      fontFamily: {
        serif: ['"Source Serif 4"', 'Georgia', 'Times New Roman', 'serif'],
        sans: ['"Libre Franklin"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      maxWidth: {
        publication: '70rem',
      },
    },
  },
  plugins: [],
}
