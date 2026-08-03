import assert from "node:assert"
import { test, describe } from "node:test"
import { roomManager, ROOM_LIMITS } from "../room-manager"

describe("PartyRoomManager Unit Tests", () => {
  const hostId = "user_host_1"
  const hostName = "HostUser"
  const guestId = "user_guest_2"
  const guestName = "GuestUser"

  test("createRoom generates valid room and assigns ownership", () => {
    const snap = roomManager.createRoom(hostId, hostName, undefined, "movie_1")
    assert.ok(snap)
    assert.ok(snap.partyId.startsWith("party_"))
    assert.strictEqual(snap.ownerId, hostId)
    assert.strictEqual(snap.isOwner, true)
    assert.strictEqual(snap.members.length, 1)
    assert.strictEqual(snap.members[0].userId, hostId)
  })

  test("joinRoom adds member to party room", () => {
    const snap = roomManager.createRoom("host_join_test", "Host", undefined, "item_1")
    assert.ok(snap)

    const joined = roomManager.joinRoom(snap.partyId, guestId, guestName)
    assert.ok(joined)
    assert.strictEqual(joined.members.length, 2)
    assert.strictEqual(joined.members.some((m) => m.userId === guestId), true)
  })

  test("leaveRoom transfers ownership when host leaves", () => {
    const snap = roomManager.createRoom("host_leave_test", "Host")
    assert.ok(snap)

    roomManager.joinRoom(snap.partyId, guestId, guestName)
    const leaveResult = roomManager.leaveRoom(snap.partyId, "host_leave_test")

    assert.strictEqual(leaveResult.roomEnded, false)
    assert.strictEqual(leaveResult.newOwnerId, guestId)

    const updatedRoom = roomManager.getRoom(snap.partyId)
    assert.ok(updatedRoom)
    assert.strictEqual(updatedRoom.ownerId, guestId)
  })

  test("leaveRoom ends party when last member leaves", () => {
    const snap = roomManager.createRoom("solo_host", "SoloHost")
    assert.ok(snap)

    const leaveResult = roomManager.leaveRoom(snap.partyId, "solo_host")
    assert.strictEqual(leaveResult.roomEnded, true)

    const room = roomManager.getRoom(snap.partyId)
    assert.strictEqual(room, undefined)
  })

  test("applyCommand rate change rejected for non-owner", () => {
    const snap = roomManager.createRoom("rate_test_host", "Host", undefined, "item_rate")
    assert.ok(snap)
    roomManager.joinRoom(snap.partyId, guestId, guestName)

    const state = roomManager.applyCommand(snap.partyId, guestId, {
      type: "rate",
      playbackRate: 2.0,
      clientId: "tab_guest",
      commandId: "cmd_1",
    })

    assert.ok(state)
    assert.strictEqual(state.playbackRate, 1.0) // Rate remains unchanged
  })

  test("applyCommand play command allowed for host", () => {
    const snap = roomManager.createRoom("play_test_host", "Host", undefined, "item_play")
    assert.ok(snap)

    const state = roomManager.applyCommand(snap.partyId, "play_test_host", {
      type: "play",
      positionSec: 10,
      clientId: "tab_host",
      commandId: "cmd_play",
    })

    assert.ok(state)
    assert.strictEqual(state.playing, true)
    assert.strictEqual(state.positionSec, 10)
  })

  test("setBuffering pauses room when member is buffering and resumes when clear", () => {
    const snap = roomManager.createRoom("buf_test_host", "Host", undefined, "item_buf")
    assert.ok(snap)
    roomManager.joinRoom(snap.partyId, guestId, guestName)

    // Guest starts buffering
    const bufState = roomManager.setBuffering(snap.partyId, guestId, true, 12)
    assert.ok(bufState)
    assert.strictEqual(bufState.playing, false)
    assert.strictEqual(bufState.reason, "buffer-pause")

    // Guest stops buffering
    const resState = roomManager.setBuffering(snap.partyId, guestId, false, 12)
    assert.ok(resState)
    assert.strictEqual(resState.playing, true)
    assert.strictEqual(resState.reason, "buffer-resume")
    // Exact-progress guarantee: resume keeps the buffer-pause position
    assert.strictEqual(resState.positionSec, bufState.positionSec)
  })

  test("buffer pause/resume clear senderClientId so no client echo-suppresses them", () => {
    const snap = roomManager.createRoom("buf_echo_host", "Host", undefined, "item_buf_echo")
    assert.ok(snap)
    roomManager.joinRoom(snap.partyId, guestId, guestName)

    // Host issues a command -> stamps senderClientId
    const cmdState = roomManager.applyCommand(snap.partyId, "buf_echo_host", {
      type: "play",
      positionSec: 5,
      clientId: "tab_host",
      commandId: "cmd_echo",
    })
    assert.ok(cmdState)
    assert.strictEqual(cmdState.senderClientId, "tab_host")

    // Buffer pause and resume must both be sender-agnostic system events
    const bufState = roomManager.setBuffering(snap.partyId, guestId, true, 12)
    assert.ok(bufState)
    assert.strictEqual(bufState.senderClientId, undefined)

    const resState = roomManager.setBuffering(snap.partyId, guestId, false, 12)
    assert.ok(resState)
    assert.strictEqual(resState.senderClientId, undefined)
  })

  test("setBuffering resumes after a command (pause/seek) during buffer-pause", () => {
    const snap = roomManager.createRoom("buf_cmd_host", "Host", undefined, "item_buf_cmd")
    assert.ok(snap)
    roomManager.joinRoom(snap.partyId, guestId, guestName)

    // Guest starts buffering -> room pauses
    const bufState = roomManager.setBuffering(snap.partyId, guestId, true, 12)
    assert.ok(bufState)
    assert.strictEqual(bufState.playing, false)

    // A command (e.g. seek) during the buffer-pause overwrites `reason`
    const cmdState = roomManager.applyCommand(snap.partyId, guestId, {
      type: "seek",
      positionSec: 14,
      clientId: "tab_guest",
      commandId: "cmd_seek",
    })
    assert.ok(cmdState)
    assert.strictEqual(cmdState.playing, false)
    assert.strictEqual(cmdState.reason, "command")

    // Buffer clears -> must still auto-resume even though reason isn't buffer-pause
    const resState = roomManager.setBuffering(snap.partyId, guestId, false, 14)
    assert.ok(resState)
    assert.strictEqual(resState.playing, true)
    assert.strictEqual(resState.reason, "buffer-resume")
    assert.strictEqual(resState.positionSec, 14)
  })

  test("setBuffering resumes only after the last buffering member clears", () => {
    const snap = roomManager.createRoom("buf_multi_host", "Host", undefined, "item_buf_multi")
    assert.ok(snap)
    const guest2Id = "user_guest_3"
    roomManager.joinRoom(snap.partyId, guestId, guestName)
    roomManager.joinRoom(snap.partyId, guest2Id, "Guest3")

    // Both guests buffering -> room paused
    roomManager.setBuffering(snap.partyId, guestId, true, 10)
    const midState = roomManager.setBuffering(snap.partyId, guest2Id, true, 11)
    assert.ok(midState)
    assert.strictEqual(midState.playing, false)

    // First guest clears -> still paused (second still buffering)
    const stillPaused = roomManager.setBuffering(snap.partyId, guestId, false, 10)
    assert.ok(stillPaused)
    assert.strictEqual(stillPaused.playing, false)

    // Last member clears -> resumes
    const resState = roomManager.setBuffering(snap.partyId, guest2Id, false, 11)
    assert.ok(resState)
    assert.strictEqual(resState.playing, true)
    assert.strictEqual(resState.reason, "buffer-resume")
  })

  test("non-owner play is rejected during a buffer-pause", () => {
    const snap = roomManager.createRoom("buf_play_guest", "Host", undefined, "item_bp1")
    assert.ok(snap)
    roomManager.joinRoom(snap.partyId, guestId, guestName)

    roomManager.setBuffering(snap.partyId, guestId, true, 20)

    const state = roomManager.applyCommand(snap.partyId, guestId, {
      type: "play",
      positionSec: 20,
      clientId: "tab_guest",
      commandId: "cmd_bp1",
    })
    assert.ok(state)
    assert.strictEqual(state.playing, false) // play rejected, room stays paused
  })

  test("host play is ALSO rejected during a buffer-hold (strict — no force-resume)", () => {
    const snap = roomManager.createRoom("buf_play_host", "Host", undefined, "item_bp2")
    assert.ok(snap)
    roomManager.joinRoom(snap.partyId, guestId, guestName)

    roomManager.setBuffering(snap.partyId, guestId, true, 20)

    const state = roomManager.applyCommand(snap.partyId, "buf_play_host", {
      type: "play",
      positionSec: 20,
      clientId: "tab_host",
      commandId: "cmd_bp2",
    })
    assert.ok(state)
    assert.strictEqual(state.playing, false) // nobody resumes over a hold

    const room = roomManager.getRoom(snap.partyId)!
    // The buffering member is never cleared or left behind — the room waits
    assert.strictEqual(room.members.get(guestId)!.buffering, true)

    // Only a genuine recovery report releases the hold
    const resState = roomManager.setBuffering(snap.partyId, guestId, false, 20)
    assert.ok(resState)
    assert.strictEqual(resState.playing, true)
    assert.strictEqual(resState.reason, "buffer-resume")
  })

  test("no auto force-clear: a repeated stall after recovery pauses the room again", () => {
    const snap = roomManager.createRoom("buf_lag_host", "Host", undefined, "item_bp3")
    assert.ok(snap)
    roomManager.joinRoom(snap.partyId, guestId, guestName)

    roomManager.setBuffering(snap.partyId, guestId, true, 20)
    roomManager.setBuffering(snap.partyId, guestId, false, 20)

    // A NEW stall must always pause the room — there is no force-cleared path
    const pausedAgain = roomManager.setBuffering(snap.partyId, guestId, true, 25)
    assert.ok(pausedAgain)
    assert.strictEqual(pausedAgain.playing, false)
    assert.strictEqual(pausedAgain.reason, "buffer-pause")
  })

  test("ghost member (crashed tab mid-stall) is pruned by heartbeat and room resumes", () => {
    const snap = roomManager.createRoom("buf_ghost_host", "Host", undefined, "item_bp4")
    assert.ok(snap)
    roomManager.joinRoom(snap.partyId, guestId, guestName)

    roomManager.setBuffering(snap.partyId, guestId, true, 30)

    // Simulate the member's tab dying mid-stall: stale lastSeenAt, never recovers
    const room = roomManager.getRoom(snap.partyId)!
    const stale = Date.now() - 100_000
    room.lastSeenAt.set(guestId, stale)
    room.members.get(guestId)!.lastSeenAt = stale

    // A live member's heartbeat triggers the prune
    const resState = roomManager.touchPresence(snap.partyId, "buf_ghost_host")
    assert.ok(resState === undefined)
    const updatedRoom = roomManager.getRoom(snap.partyId)!
    assert.strictEqual(updatedRoom.members.has(guestId), false)
    assert.strictEqual(updatedRoom.state!.playing, true)
    assert.strictEqual(updatedRoom.state!.reason, "buffer-resume")
  })

  test("clean leave by the only buffering member releases the buffer-hold", () => {
    const snap = roomManager.createRoom("buf_leave_host", "Host", undefined, "item_bp5")
    assert.ok(snap)
    roomManager.joinRoom(snap.partyId, guestId, guestName)

    roomManager.setBuffering(snap.partyId, guestId, true, 40)
    const pausedRoom = roomManager.getRoom(snap.partyId)!
    assert.strictEqual(pausedRoom.state!.playing, false)
    assert.strictEqual(pausedRoom.pausedForBuffering, true)

    // The stalled member closes the tab cleanly (leave beacon) — no crash
    // prune ever runs, but the hold must still release, or the remaining
    // host is paused forever.
    const leaveResult = roomManager.leaveRoom(snap.partyId, guestId)
    assert.strictEqual(leaveResult.roomEnded, false)

    const updatedRoom = roomManager.getRoom(snap.partyId)!
    assert.strictEqual(updatedRoom.state!.playing, true)
    assert.strictEqual(updatedRoom.state!.reason, "buffer-resume")
    // System-generated event: must not carry a clientId or the remaining
    // member's echo suppression would skip applying the resume
    assert.strictEqual(updatedRoom.state!.senderClientId, undefined)
  })

  test("leave by a non-buffering member does not release another member's hold", () => {
    const snap = roomManager.createRoom("buf_leave2_host", "Host", undefined, "item_bp6")
    assert.ok(snap)
    const guest2Id = "user_guest_leave2"
    roomManager.joinRoom(snap.partyId, guestId, guestName)
    roomManager.joinRoom(snap.partyId, guest2Id, "GuestL2")

    // Host (non-buffering) leaves while the guest is still stalled
    roomManager.setBuffering(snap.partyId, guestId, true, 45)
    roomManager.leaveRoom(snap.partyId, "buf_leave2_host")

    const updatedRoom = roomManager.getRoom(snap.partyId)!
    assert.strictEqual(updatedRoom.state!.playing, false)
    assert.strictEqual(updatedRoom.pausedForBuffering, true)
  })

  test("applyCommand compensates sender transport latency via sentAt", () => {
    const snap = roomManager.createRoom("latency_host", "Host", undefined, "item_lat")
    assert.ok(snap)

    // Play captured ~150ms before the server processes it: position advances
    const sentAt = Date.now() - 150
    const state = roomManager.applyCommand(snap.partyId, "latency_host", {
      type: "play",
      positionSec: 100,
      sentAt,
      clientId: "tab_host",
      commandId: "cmd_lat1",
    })
    assert.ok(state)
    assert.ok(state.positionSec > 100 + 0.1, `expected advance, got ${state.positionSec}`)
    assert.ok(state.positionSec <= 100 + 0.5)

    // Pauses capture the exact stop point — never advanced
    const pauseState = roomManager.applyCommand(snap.partyId, "latency_host", {
      type: "pause",
      positionSec: state.positionSec,
      sentAt: Date.now() - 120,
      clientId: "tab_host",
      commandId: "cmd_lat2",
    })
    assert.ok(pauseState)
    assert.strictEqual(pauseState.positionSec, state.positionSec)
  })

  test("applyCommand clamps sentAt compensation so poisoned timestamps can't distort the playhead", () => {
    const snap = roomManager.createRoom("latency_clamp_host", "Host", undefined, "item_lat2")
    assert.ok(snap)

    // sentAt 60s in the past — compensation saturates at the 2s clamp
    const state = roomManager.applyCommand(snap.partyId, "latency_clamp_host", {
      type: "play",
      positionSec: 50,
      sentAt: Date.now() - 60_000,
      clientId: "tab_host",
      commandId: "cmd_lat3",
    })
    assert.ok(state)
    assert.ok(state.positionSec >= 51.9 && state.positionSec <= 52.5, `got ${state.positionSec}`)
  })

  test("capacity limits constants are properly defined", () => {
    assert.strictEqual(ROOM_LIMITS.MAX_ROOMS_PER_USER, 5)
    assert.strictEqual(ROOM_LIMITS.MAX_ROOM_CAPACITY, 50)
  })
})
