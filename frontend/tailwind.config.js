/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        chinese: {
          red: '#C0392B',
          gold: '#D4A843',
          cream: '#FBF6EE',
          darkred: '#922B21',
        },
      },
      fontFamily: {
        chinese: ['"Noto Serif TC"', 'serif'],
        thai: ['"Noto Sans Thai"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
