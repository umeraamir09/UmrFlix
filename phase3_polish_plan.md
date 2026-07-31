# Watch Party — Phase 3 Polish Plan

## Problem Analysis & Root Causes

### Issue 1 — PartyBar UI Refresh + Collapsible Toggle

**Current state**: The `PartyBar` is a flat horizontal strip pinned to the top-right corner with no way to hide it. It permanently obscures the video and has minimal visual hierarchy.

**Desired state**: A polished, collapsible bar that can be toggled in/out of view without interrupting playback. Should feel like a cinema control overlay — elegant and non-intrusive.

---

### Issue 2 — Notifications Not Delivered In-App (SSE Path Broken)

**Root Cause — Audience Filtering Race**:

The current `addPartyInviteNotification` emits a `notification:created` event like this:
```ts
eventBus.emitEvent({ type: "notification:created", payload: notifPayload })
```
Where `notifPayload` is a `UserNotification` (has `userId`, not `audience`). However, the SSE route checks:
```ts
const payload = event.payload as { audience?: string[] } | undefined
if (payload?.audience && Array.isArray(payload.audience)) {
  if (!payload.audience.includes(session.userId)) return // filtered
}
```
Since `UserNotification` has no `audience` field, the check falls through (audience undefined) and the event is **broadcast to all connected users** — correct. So SSE delivery is not the filtering problem.

**Root Cause — `notificationCreated` handler is passive**:

In `use-event-stream.ts`, the `notificationCreated` handler is:
```ts
const notificationCreated = () => {
  mutate("/api/notifications")
  notifyReFetch()
}
```
It just **revalidates the SWR cache**. The `NotificationBell` needs to receive this revalidation and update its unread badge. This only works if `NotificationBell` is subscribed to `/api/notifications` via SWR and calls `useEventStream`.

**Root Cause — `NotificationBell` fetches once at mount, no live update**:

Looking at `NotificationBell`, it uses `useEventStream` and calls `onReFetch`. The SWR mutation targets `/api/notifications`, but the `NotificationBell` likely uses its own internal `useState` + `useEffect` fetch — **not SWR** — meaning the `mutate` call doesn't trigger a re-fetch.

Additionally, `notification:created` carries `payload: UserNotification` which includes the `userId` of the recipient. Any user on the SSE stream receives it. We need to **scope notification delivery to the invited user only** by wrapping the `UserNotification` in an `audience` array.

**Fix**:
1. In `addPartyInviteNotification` — wrap notification in an `audience: [notifPayload.userId]` envelope.
2. In `use-event-stream.ts` — update `notificationCreated` to also fire a toast when the event's `userId` matches the current session (fetch `GET /api/auth/me` on mount to cache current user ID).
3. Convert `NotificationBell` internal fetch to SWR so `mutate("/api/notifications")` triggers a live re-render.

---

### Issue 3 — TV Show Support (Episode Selection + Next Episode Party Transitions)

**Root Cause A — Series ID passed to CinemaPlayer, not episode ID**:

When a party is started from a TV show detail page via `StartPartyModal`, the `itemId` stored in the room is likely the Jellyfin **Series ID** (not an individual episode ID). Jellyfin's `PlaybackInfo` endpoint cannot serve a series — it expects an episode ID, hence the `500 error`.

**Root Cause B — No episode selection flow in the Watch Party lobby**:

The `PartyLobby` search surfaces `Episode` type items but has no concept of browsing a full series and picking an episode cleanly. The host needs a series → episode picker.

**Root Cause C — Next episode party transition is not wired to party `item` command**:

When the host's `onNextEpisode` fires in `CinemaPlayer`, it updates `resolvedId` in `WatchPage` locally. It does NOT emit a `party:item` command to the room, so guests stay on the current episode while the host moves forward.

**Fixes**:
1. **StartPartyModal**: When starting from a TV show detail page, detect whether the `itemId` is a series. If so, fetch episodes and open an episode picker before creating the room.
2. **PartyLobby (Host)**: Add a "Browse Series" mode alongside the search — when a Series item is picked, expand an inline episode list and let the host pick a specific episode.
3. **WatchPage**: When party is active and host presses next episode, emit `POST /api/party/[id]/item` with the new episode ID so all guests follow.

---

## Proposed Changes

### A. PartyBar UI Refresh + Toggle

#### [MODIFY] [PartyBar.tsx](file:///c:/Users/umert/OneDrive/Desktop/UmrFlix/umrflix/src/components/party/PartyBar.tsx)

- Add `isCollapsed` local state (default: `false`, persisted to `sessionStorage` key `party-bar-collapsed`).
- When collapsed: render only a small floating pill with the member count and a toggle chevron icon. No buffering chip, no buttons — just the pill.
- When expanded: render the full current bar with all controls.
- Add a smooth CSS transition (`transition-all duration-300`) between collapsed/expanded states.
- Add a dedicated toggle button (chevron icon) at the leftmost position of the expanded bar.
- Visual refresh: use a more premium glassmorphism style — stronger `backdrop-blur-xl`, subtle gradient border (`border-white/15`), slightly rounded corners, and better spacing.

---

### B. Fix In-App Notification Delivery

#### [MODIFY] [event-bus.ts](file:///c:/Users/umert/OneDrive/Desktop/UmrFlix/umrflix/src/lib/event-bus.ts)

- Extend `notification:created` event type to allow an `audience` field:
  ```ts
  | { type: "notification:created"; payload: UserNotification & { audience?: string[] } }
  ```

#### [MODIFY] [requests-store.ts](file:///c:/Users/umert/OneDrive/Desktop/UmrFlix/umrflix/src/lib/requests-store.ts)

- In `addPartyInviteNotification`, wrap the emitted SSE event with `audience: [notifPayload.userId]` so only the correct user's SSE stream receives it:
  ```ts
  eventBus.emitEvent({
    type: "notification:created",
    payload: { ...notifPayload, audience: [notifPayload.userId] },
  })
  ```

#### [MODIFY] [NotificationBell.tsx](file:///c:/Users/umert/OneDrive/Desktop/UmrFlix/umrflix/src/components/NotificationBell.tsx)

- Replace internal `useState` + `useEffect` fetch with `useSWR("/api/notifications", fetcher)`.
- Listen to SSE `notification:created` events via a direct `EventSource` listener to call `mutate()` on arrival (or use `useEventStream`'s re-fetch signal via `onReFetch`).
- Add a `toast` when a new `party_invite` notification arrives (displayed as: `"🎉 You've been invited to a Watch Party!"`).

#### [MODIFY] [use-event-stream.ts](file:///c:/Users/umert/OneDrive/Desktop\UmrFlix\umrflix\src\lib\use-event-stream.ts)

- Update `notificationCreated` to parse the event data and show a targeted toast for `party_invite` type:
  ```ts
  const notificationCreated = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data)
      mutate("/api/notifications")
      notifyReFetch()
      if (data.type === "party_invite") {
        toast(`🎉 You've been invited to a Watch Party! Check your notifications.`, "info")
      }
    } catch { ... }
  }
  ```

---

### C. TV Show Episode Support

#### [MODIFY] [StartPartyModal.tsx](file:///c:/Users/umert/OneDrive/Desktop/UmrFlix/umrflix/src/components/party/StartPartyModal.tsx)

- Accept an optional `seriesId?: string` prop (the Jellyfin series ID when starting from a TV show detail page).
- When `seriesId` is provided, on modal open: fetch `/api/jellyfin/series/${seriesId}/episodes` and display an episode picker step before creating the room.
- Episode picker: shows a scrollable list of available episodes grouped by season. Host selects one, then proceeds to invite users. The selected episode ID is set as `itemId` when the room is created via `POST /api/party`.

#### [MODIFY] [RequestButton.tsx](file:///c:/Users/umert/OneDrive/Desktop/UmrFlix/umrflix/src/components/RequestButton.tsx)

- Pass the Jellyfin series ID to `StartPartyModal` as `seriesId` when the media type is `tv`. Currently only `tmdbId` and `title` are passed — also pass the resolved `jellyfinSeriesId` (available via the `availability` prop's `jellyfinItemId`).

#### [MODIFY] [PartyLobby.tsx](file:///c:/Users/umert/OneDrive/Desktop/UmrFlix/umrflix/src/components/party/PartyLobby.tsx)

- Update search to include `Series` in `includeItemTypes`.
- When a `Series` result is clicked (not `Movie` or `Episode`), enter a sub-view: fetch all episodes for that series and show a season/episode picker.
- When a `Movie` or `Episode` is selected directly, call `POST /api/party/[id]/item` as today.
- Add a "← Back to search" button in the episode picker sub-view.

#### [MODIFY] [WatchPage.tsx](file:///c:/Users/umert/OneDrive/Desktop/UmrFlix/umrflix/src/components/WatchPage.tsx)

- Add `handlePartyNextEpisode` callback: when in party mode and host advances to next episode, emit `POST /api/party/[id]/item` with the new episode ID before calling `setResolvedId`.
- Pass `onNextEpisode` as `handlePartyNextEpisode` when `partyInfo && partyInfo.isOwner`.
- Guests: `onNextEpisode` should be `undefined` — they follow via the `party:item` SSE event which already calls `onPartyItemChange`.

---

## File Change Summary

| File | Change |
|------|--------|
| `src/components/party/PartyBar.tsx` | Full UI refresh + collapsible toggle with sessionStorage persistence |
| `src/lib/event-bus.ts` | Add `audience` to `notification:created` event type |
| `src/lib/requests-store.ts` | Emit `notification:created` with `audience: [userId]` in `addPartyInviteNotification` |
| `src/components/NotificationBell.tsx` | Convert to SWR + handle live invite toast |
| `src/lib/use-event-stream.ts` | Parse notification event data, show party invite toast |
| `src/components/party/StartPartyModal.tsx` | Accept `seriesId`, show episode picker step for TV shows |
| `src/components/RequestButton.tsx` | Pass `jellyfinSeriesId` to `StartPartyModal` for TV shows |
| `src/components/party/PartyLobby.tsx` | Add Series → episode picker sub-view in content search |
| `src/components/WatchPage.tsx` | Wire `onNextEpisode` → `POST /api/party/[id]/item` for party host |

---

## Verification Plan

### Automated
```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue; npx tsc --noEmit --skipLibCheck
```

### Manual Verification Checklist

**PartyBar Toggle**:
- [ ] Party bar renders in expanded state by default
- [ ] Click chevron → bar collapses to a small pill with member count
- [ ] Click pill → bar expands again
- [ ] Collapsed state survives a page refresh (sessionStorage)

**Notification In-App Delivery**:
- [ ] User A invites User B → User B sees a toast "🎉 You've been invited to a Watch Party!"
- [ ] User B opens Notification Bell → sees the invite with "Join Party" button
- [ ] User A does NOT receive the toast (audience filtering working)

**TV Show Party Flow**:
- [ ] Click "Watch Party" on a TV show detail page → episode picker appears in modal
- [ ] Host selects an episode → party room created with that episode's Jellyfin ID
- [ ] Guest joins → CinemaPlayer loads the correct episode (no 500 error)
- [ ] Host clicks "Next Episode" → all party members advance to the same next episode

> [!IMPORTANT]
> The `RequestButton.tsx` currently reads `availability.jellyfinItemId` for the series ID. We need to verify this field is the Jellyfin **Series** ID and not an individual episode ID before passing it to `StartPartyModal`.
