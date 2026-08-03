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

  test("host can force-resume over a buffer-hold; laggard is left behind", () => {
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
    assert.strictEqual(state.playing, true)

    const room = roomManager.getRoom(snap.partyId)!
    // Laggard's flag cleared and marked as left behind
    assert.strictEqual(room.members.get(guestId)!.buffering, false)
    assert.strictEqual(room.forceClearedAt.has(guestId), true)
  })

  test("left-behind member stalls are ignored until they recover once", () => {
    const snap = roomManager.createRoom("buf_lag_host", "Host", undefined, "item_bp3")
    assert.ok(snap)
    roomManager.joinRoom(snap.partyId, guestId, guestName)

    // Guest stalls, host force-resumes, guest is left behind
    roomManager.setBuffering(snap.partyId, guestId, true, 20)
    roomManager.applyCommand(snap.partyId, "buf_lag_host", {
      type: "play",
      positionSec: 20,
      clientId: "tab_host",
      commandId: "cmd_bp3",
    })

    // Laggard still stalling -> report ignored, room keeps playing
    const stillPlaying = roomManager.setBuffering(snap.partyId, guestId, true, 20)
    assert.ok(stillPlaying)
    assert.strictEqual(stillPlaying.playing, true)

    // Laggard recovers -> marker lifts
    const afterRecovery = roomManager.setBuffering(snap.partyId, guestId, false, 25)
    assert.ok(afterRecovery)
    const room = roomManager.getRoom(snap.partyId)!
    assert.strictEqual(room.forceClearedAt.has(guestId), false)

    // A NEW stall now pauses the room again (normal sync behavior)
    const pausedAgain = roomManager.setBuffering(snap.partyId, guestId, true, 25)
    assert.ok(pausedAgain)
    assert.strictEqual(pausedAgain.playing, false)
    assert.strictEqual(pausedAgain.reason, "buffer-pause")
  })

  test("capacity limits constants are properly defined", () => {
    assert.strictEqual(ROOM_LIMITS.MAX_ROOMS_PER_USER, 5)
    assert.strictEqual(ROOM_LIMITS.MAX_ROOM_CAPACITY, 50)
  })
})
