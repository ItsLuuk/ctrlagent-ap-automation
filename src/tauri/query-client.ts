import { QueryClient } from "@tanstack/react-query";

/**
 * One client for the desktop app, in its own module so the root route file
 * exports components only. The router's context and the shell's provider both
 * take this instance — two clients would be two caches waiting to disagree the
 * day something queries through them.
 */
export const tauriQueryClient = new QueryClient();
