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
  })

  test("capacity limits constants are properly defined", () => {
    assert.strictEqual(ROOM_LIMITS.MAX_ROOMS_PER_USER, 5)
    assert.strictEqual(ROOM_LIMITS.MAX_ROOM_CAPACITY, 50)
  })
})
