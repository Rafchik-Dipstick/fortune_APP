/**
 * Whether the client presents a Game Center proof carrying a temporary scoped
 * identifier instead of refusing it on the device.
 *
 * Always true, and deliberately a constant rather than an expression. Game
 * Center reports scoped identifiers as non-persistent for any app it has not
 * yet seen published on the App Store — TestFlight and App Review included,
 * not only development builds. This was previously derived from the resolved
 * app environment, which meant a production binary refused every temporary
 * identifier and locked App Review out of the only sign-in the app offers.
 *
 * The decision does not belong on the client at all: the server refuses the
 * same allowance unless its own deployment sets
 * `GAME_CENTER_ALLOW_NONPERSISTENT_IDS`, so the fence is one an operator
 * grants and revokes and a binary can never grant to itself. Lives in its own
 * module so the value the wiring actually passes is testable without
 * constructing the React provider.
 */
export const allowNonPersistentGameCenterIds = true;
