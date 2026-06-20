feat: convert entire mobile app to monochrome theme + simplify SplashScreen auth

## Monochrome Theme Conversion

Converted the entire Kinetik mobile app from a dark gradient-heavy theme
(pink/purple/green accents) to a clean black-and-white monochrome design.

### Theme foundation (theme/index.ts)
- All 40+ color tokens replaced: white (#FFFFFF) background, black (#000000)
  text, grayscale surfaces (#F8F8F8 → #E8E8E8), muted grays for borders
- Removed all accent colors (pink #FF3B7F, purple #7C3AED, green #06D6A0)
- Added textInverse (#FFFFFF) for text on dark surfaces

### Common components
- Button.tsx: Removed LinearGradient wrapper; primary is now solid black
  with white text, secondary uses gray surface with gray text
- Card.tsx: Replaced colored glow shadow with black border glow
- Avatar.tsx: Replaced LinearGradient with solid border for glow effect
- Input.tsx: Added focus-state styling — black background + white text on focus,
  reverts to light gray background + black text on blur (placeholder stays
  normal weight, not bold)

### All 23 screen files
- Removed imports and usages of LinearGradient from expo-linear-gradient
- Replaced gradient backgrounds with solid grayscale surfaces
- Converted all rgba() colored overlays and accent colors to black/gray
- Updated StatusBar to "dark" style for light background

### SplashScreen simplification
- Removed email Input field from registration form (mobile number is sufficient)
- Removed social auth section (Apple/Google "or continue with" divider + buttons)
- Cleaned up unused styles and state

### Fixes
- Restored missing dateTextActive/timeTextActive styles in CalendarSyncScreen
  (regression from theme conversion — active date chips now show white text
  on black background)
- Cleaned up unused countdownGradient reference in FlashCountdownScreen
