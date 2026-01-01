# Seemplify AI Logo Usage Guide

## Logo Concept

The Seemplify AI logo represents:
- **"S" Shape**: Flowing curves forming an "S" for Seemplify
- **Connected Nodes**: Network/connection points representing HR integration and team connectivity
- **AI Accents**: Small accent lines indicating AI capabilities
- **Gradient**: Blue → Purple → Pink gradient representing innovation and modern tech

## Components

### 1. `SeemplifyLogo` - Full Animated Logo
Main logo with animation capabilities. Best for hero sections and key branding moments.

```tsx
import SeemplifyLogo from '@/components/SeemplifyLogo'

// Default (medium, animated)
<SeemplifyLogo />

// Large, non-animated
<SeemplifyLogo size="lg" animated={false} />
```

**Sizes**: `sm` (32px), `md` (44px), `lg` (56px), `xl` (72px)

### 2. `SeemplifyIcon` - Simplified Icon
Simplified version for small sizes (navigation, favicons, etc.)

```tsx
import { SeemplifyIcon } from '@/components/SeemplifyLogo'

<SeemplifyIcon size="sm" />
```

**Sizes**: `sm` (24px), `md` (32px), `lg` (40px), `xl` (48px)

### 3. `SeemplifyLogoWithText` - Logo + Text Lockup
Combined logo with "SeemplifyAI" text and tagline.

```tsx
import { SeemplifyLogoWithText } from '@/components/SeemplifyLogo'

<SeemplifyLogoWithText size="lg" animated={true} />
```

## Static Files

### SVG Files (in `/public`)
- `logo.svg` - Full logo (100x100)
- `logo-icon.svg` - Simplified icon version (100x100)

Use these for:
- Social media profiles
- Email signatures
- Print materials
- External platforms

## Color Palette

```css
/* Primary Gradient */
--gradient-start: #3b82f6;  /* Blue 500 */
--gradient-mid: #8b5cf6;    /* Purple 500 */
--gradient-end: #ec4899;    /* Pink 500 */

/* Accent Colors */
--accent-blue: #3b82f6;
--accent-purple: #8b5cf6;
--accent-pink: #ec4899;
```

## Usage Guidelines

### ✅ Do:
- Use on dark backgrounds for best visibility
- Maintain aspect ratio when resizing
- Use the animated version sparingly (hero sections only)
- Ensure clear space around the logo (minimum 20% of logo width)

### ❌ Don't:
- Don't change the gradient colors
- Don't remove the connection nodes
- Don't rotate or skew the logo
- Don't use on busy backgrounds without proper contrast
- Don't animate on every page load (performance)

## Examples

### Header Navigation
```tsx
<Link href="/" className="flex items-center gap-3">
  <SeemplifyLogo size="md" animated={false} />
  <span>SeemplifyAI</span>
</Link>
```

### Hero Section
```tsx
<div className="hero">
  <SeemplifyLogo size="xl" animated={true} />
</div>
```

### Footer
```tsx
<footer>
  <SeemplifyIcon size="md" />
  <span>SeemplifyAI</span>
</footer>
```
