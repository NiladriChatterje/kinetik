feat: redesign receiver-side view-once CTA from square button to polished card

Redesigned the "View once" call-to-action that recipients see before
opening ephemeral media. The old design was a large 180×180 solid square
with a centered icon and text. The new design is a compact, layered card
that feels more premium and informative, inspired by WhatsApp's treatment.

## Changes

### ChatScreen (`packages/mobile/src/screens/match/ChatScreen.tsx`)

**Receiver-side CTA (before viewing):**
- Old: 180×180 dark square with eye icon + "View once" + "Tap to open"
- New: Compact card with three distinct sections:
  • **Top row**: Primary-tinted icon ring with eye icon, "View once photo"
    or "View once video" label, subtitle with media type hint, and a pill
    badge with lock icon + "1"
  • **Divider**: Subtle horizontal separator line
  • **Footer**: Info icon + dynamic text "This photo/video will disappear
    after viewing" (respects media type)
- Card has a dark background (`#1a1a2e`) with subtle primary border
  (`rgba(99,102,241,0.25)`) and rounded corners, distinct from the
  message bubble
- `activeOpacity` adjusted to `0.85` for smoother feedback