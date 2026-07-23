export function elapsedTimerSeconds(startedAt: string, nowMilliseconds: number) {
  const startedMilliseconds = new Date(startedAt).getTime();
  if (!Number.isFinite(startedMilliseconds) || !Number.isFinite(nowMilliseconds)) {
    return 0;
  }
  return Math.max(0, Math.floor((nowMilliseconds - startedMilliseconds) / 1_000));
}

export function advanceClockFromSnapshot(
  serverSnapshotMilliseconds: number,
  clientSnapshotMilliseconds: number,
  clientNowMilliseconds: number,
) {
  if (
    !Number.isFinite(serverSnapshotMilliseconds)
    || !Number.isFinite(clientSnapshotMilliseconds)
    || !Number.isFinite(clientNowMilliseconds)
  ) {
    return serverSnapshotMilliseconds;
  }
  return serverSnapshotMilliseconds
    + Math.max(0, clientNowMilliseconds - clientSnapshotMilliseconds);
}

export function formatTimerDuration(durationSeconds: number) {
  const safeSeconds = Number.isFinite(durationSeconds)
    ? Math.max(0, Math.floor(durationSeconds))
    : 0;
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const seconds = safeSeconds % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}
