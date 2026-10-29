export const isCompacting = (entry) =>
  ["starting", "running", "reconnecting"].includes(entry?.status);
