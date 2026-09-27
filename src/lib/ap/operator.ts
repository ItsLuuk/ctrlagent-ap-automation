import type { Actor, ActorRole } from "./state-machine";
import type { BusinessProfile } from "./types";

/** Human roles the local operator may exercise. Identity is resolved from Settings. */
export const OPERATOR_ROLES: ActorRole[] = ["processor", "approver", "treasury"];

/** The honest fallback before the operator has supplied a name. */
export const UNNAMED_OPERATOR = "You";

/** The operator's own name, trimmed, or the honest fallback when unset. */
export function operatorName(profile?: Pick<BusinessProfile, "operatorName"> | undefined): string {
  return profile?.operatorName?.trim() || UNNAMED_OPERATOR;
}

/**
 * The one actor this install signs as. Holding every human role does not bypass
 * segregation of duties: the enabled policy compares this person's name with
 * earlier responsibilities, so a single-user install is blocked rather than
 * silently exempted.
 */
export function operatorActor(profile?: Pick<BusinessProfile, "operatorName"> | undefined): Actor {
  return { name: operatorName(profile), roles: [...OPERATOR_ROLES] };
}

/** Narrows the configured operator to the role required by the current action. */
export function operatorActorWithRole(
  role: Exclude<ActorRole, "system">,
  profile?: Pick<BusinessProfile, "operatorName"> | undefined,
): Actor {
  return { name: operatorName(profile), roles: [role] };
}
