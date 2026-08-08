export async function closeWorkbenchSession(
  close: () => Promise<void>,
  commandTail: Promise<void>,
): Promise<void> {
  const closeTask = close();
  const [closeResult] = await Promise.allSettled([
    closeTask,
    commandTail,
  ]);

  if (closeResult.status === 'rejected') {
    throw closeResult.reason;
  }
}
