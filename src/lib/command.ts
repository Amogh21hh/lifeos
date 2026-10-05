/** Link that opens the Command Center pre-filled with a command. Plain module: usable on server and client. */
export function commandHref(command: string) {
  return `/command?q=${encodeURIComponent(command)}`;
}
