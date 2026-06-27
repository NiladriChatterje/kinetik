feat: add photo management (set primary, delete) + loading spinner to profile screen

ProfileLedgerScreen improvements:
- Photos are now tappable: tap a non-primary photo to set as primary or
  delete it; tap the primary photo to delete it (with confirmation alert)
- Loading overlay with spinner on the photo being mutated
- Full-screen loading spinner while initial profile data is fetched
- Photo count display (e.g. "3 / 6")
- Refreshes photos list automatically after mutations
- Proper API response checking on setPrimaryPhoto
