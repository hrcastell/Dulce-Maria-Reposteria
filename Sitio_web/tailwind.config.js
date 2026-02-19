/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'turquoise': {
          100: '#d0f3f3',
          500: '#40cece',
          600: '#2fb8b8',
        },
        'pastel': {
          'blue': '#E3F2FD',
          'blue-dark': '#BBDEFB'
        }
      }
    },
  },
  plugins: [],
}
