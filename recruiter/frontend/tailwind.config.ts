import type { Config } from "tailwindcss"

const config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "*.{js,ts,jsx,tsx,mdx}",
  ],
  safelist: [
    // Multi-brand system colors
    'from-blue-400', 'to-purple-500', 'bg-green-400',   // SmartHR
    'from-teal-500', 'to-cyan-600', 'bg-teal-400',      // Jetstone
    'from-orange-400', 'to-red-500', 'bg-amber-400',    // Producive
    // Metro gradient classes - 3 color scheme
    'from-indigo-500', 'to-indigo-600', // Primary
    'from-teal-500', 'to-teal-600',     // Secondary
    'from-slate-600', 'to-slate-700',   // Accent/Neutral
    // Grid classes
    'col-span-1', 'col-span-2', 'col-span-3', 'col-span-4', 'col-span-5', 'col-span-6', 'col-span-7', 'col-span-8', 'col-span-9',
    'row-span-1', 'row-span-2', 'row-span-3',
    'lg:col-span-2', 'lg:col-span-3', 'lg:col-span-5', 'lg:col-span-7', 
    'xl:col-span-1', 'xl:col-span-2', 'xl:col-span-4', 'xl:col-span-8', 
    '2xl:col-span-3', '2xl:col-span-4', '2xl:col-span-8', '2xl:col-span-9',
    'lg:row-span-1', 'lg:row-span-2', 'xl:row-span-1', 'xl:row-span-2',
    'md:col-span-1', 'md:col-span-2', 'md:col-span-3', 'md:col-span-4',
    'md:row-span-1', 'md:row-span-2',
    'sm:col-span-1', 'sm:col-span-2', 'sm:col-span-3',
    // Grid columns for different resolutions
    'lg:grid-cols-3', 'xl:grid-cols-4', '2xl:grid-cols-6',
    // 2xl tile sizes
    '2xl:col-span-1', '2xl:col-span-2', '2xl:row-span-1', '2xl:row-span-2',
    // Responsive heights
    'lg:h-28', 'xl:h-32', '2xl:h-36',
    'lg:h-18', 'xl:h-20', '2xl:h-24',
    'lg:w-18', 'xl:w-20', '2xl:w-24',
    // Responsive padding
    'lg:p-4', 'xl:p-5', '2xl:p-6',
    'lg:pt-12', 'xl:pt-14', '2xl:pt-16',
    // Responsive positioning
    'lg:-bottom-9', 'xl:-bottom-10', '2xl:-bottom-12',
    // Responsive min heights
    'lg:min-h-[130px]', 'xl:min-h-[140px]', '2xl:min-h-[180px]',
    // Responsive gaps
    '2xl:gap-5',
    // Responsive auto-rows
    '2xl:auto-rows-[minmax(180px,_1fr)]',
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      screens: {
        '1440': '1440px',
        'max-1440': {'max': '1440px'},
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        gradient: {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "gradient-x": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "gradient-xy": {
          "0%": { backgroundPosition: "0% 0%" },
          "25%": { backgroundPosition: "100% 0%" },
          "50%": { backgroundPosition: "100% 100%" },
          "75%": { backgroundPosition: "0% 100%" },
          "100%": { backgroundPosition: "0% 0%" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-1000px 0" },
          "100%": { backgroundPosition: "1000px 0" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        float: "float 3s ease-in-out infinite",
        gradient: "gradient 5s ease infinite",
        "gradient-x": "gradient-x 15s ease infinite",
        "gradient-xy": "gradient-xy 15s ease infinite",
        shimmer: "shimmer 2s infinite linear",
        "slide-up": "slide-up 0.5s ease forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config

export default config
