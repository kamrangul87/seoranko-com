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
        background: "#0a0a0a",
        card: "#111111",
        accent: "#f59e0b",
        "accent-hover": "#d97706",
        foreground: "#fafafa",
        muted: "#6b7280",
        border: "#1f1f1f",
        "border-light": "#2a2a2a",
        "card-hover": "#161616",
        success: "#22c55e",
        warning: "#f59e0b",
        danger: "#ef4444",
      },
      fontFamily: {
        outfit: ["Outfit", "sans-serif"],
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
        accent: "0 0 20px rgba(245, 158, 11, 0.15)",
        "accent-lg": "0 0 40px rgba(245, 158, 11, 0.2)",
        card: "0 1px 3px rgba(0,0,0,0.5)",
      },
    },
  },
  plugins: [],
};

export default config;
