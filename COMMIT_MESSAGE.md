feat: clickable location area chip with bottom-sheet + Geoapify polling via Redis pub/sub

Issue:
- The "Your Area" chip on the Flash page was just a static text badge with no
  interaction — users couldn't see their detailed area info
- Location data was only geocoded once during onboarding and never refreshed
- No real-time location pipeline existed for the match-engine to consume

What was fixed/added:
- "Your Area" chip is now a clickable TouchableOpacity that opens an animated
  bottom-sheet modal showing city, county, region, country, H3 cell, coordinates,
  and last-updated timestamp with a manual refresh button
- New locationPoller service in api-core: polls Geoapify every 3 minutes for
  active users (rate-limited per user via Redis TTL) and publishes location
  updates to a Redis pub/sub channel
- New GET /api/v1/users/location/area endpoint returning full area details
- New getAreaDetails() method in mobile API client
- Match-engine now subscribes to the location:updates Redis channel and caches
  location data in user:{userId}:match_data for instant spatial-matcher access
  (with automatic reconnection on Redis drops)
- No mobile-side polling — single fetch on mount, backend handles the 3-min cycle
- Also improved the profile photo options modal (native Alert.alert → custom
  bottom-sheet with photo preview, star/trash icons, spring animation)
