/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{vue,js,ts,jsx,tsx}'],
  // 关闭 preflight，避免与 Element Plus 的基础样式冲突
  corePlugins: {
    preflight: false
  },
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8'
        }
      }
    }
  },
  plugins: []
}
