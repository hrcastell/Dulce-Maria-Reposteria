/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./js/**/*.js",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],
        body: ['Montserrat', 'sans-serif'],
      },
      colors: {
        dm: {
          sky: '#D6E6EA',
          pink: '#F5C4CF',
          brown: '#8B5A3C',
          cream: '#ECE8E2',
          mint: '#BFD8D5',
        }
      }
    },
  },
  plugins: [],
}
