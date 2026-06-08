import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#FAFAF8',
        card: '#FFFFFF',
        'card-alt': '#F5F4F1',
        foreground: '#0F0F0F',
        'foreground-secondary': '#6B6B6B',
        'foreground-muted': '#9B9B9B',
        border: '#E8E8E4',
        'border-dark': '#D4D4CE',
        accent: '#FF6B2C',
        'accent-hover': '#E85A1E',
        'accent-light': '#FFF0E8',
        'accent-text': '#CC4A0F',
        muted: '#F5F4F1',
        success: '#16A34A',
        'success-light': '#DCFCE7',
        warning: '#D97706',
        'warning-light': '#FEF9C3',
      },
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: "10px",
        sm: "6px",
        md: "10px",
        lg: "14px",
        xl: "18px",
        "2xl": "24px",
        "3xl": "32px",
      },
      boxShadow: {
        sm: '0 1px 3px rgba(0,0,0,0.06)',
        md: '0 4px 12px rgba(0,0,0,0.08)',
        accent: '0 0 0 3px rgba(255,107,44,0.12)',
      },
    },
  },
  plugins: [],
};

export default config;
