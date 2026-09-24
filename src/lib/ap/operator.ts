import type { Actor, ActorRole } from "./state-machine";
import type { BusinessProfile } from "./types";

/**
 * Who runs this install.
 *
 * Foundry ships without accounts: one operator captures, reviews and hands off
 * on their own machine, so the org has exactly one member. That fact lives here
 * because the state machine's `soleUser` option — skip name-based segregation of
 * duties, keep every role gate — is what it feeds, and that value has to come
 * from one place. Two copies of "how many people are there" is how the write
 * path and the buttons that ask about it drift apart.
 *
 * Why it is not optional: name-based SoD splits `confirmed` between the person
 * who pins a vendor identity and the person who confirms the draft. With one
 * operator those are the same person by construction, and there is no second
 * processor anywhere in the app to hand the step to — so the rule could not be
 * satisfied, only obeyed into a dead end. The invoice that could not be
 * confirmed also could not be approved or handed off, which is the whole flow.
 *
 * When accounts land (docs/superpowers/plans/2026-09-23-supabase-auth-identity.md)
 * this becomes the session's member count and the exemption applies only while
 * that count is 1; this module then has no reason to exist.
 */
export const ORG_MEMBER_COUNT = 1;

/**
 * True while the install has a single member. Role gates are untouched: a
 * person still needs the role for the step they are taking, and the machine
 * still refuses the step they cannot take.
 */
export const SOLE_USER = ORG_MEMBER_COUNT === 1;

/**
 * The roles the one operator holds, and the whole of who they are.
 *
 * Every gate in the state machine is a role gate, and the single operator is
 * the one person who has to clear all of them: processor to register a vendor
 * and confirm a draft, approver to approve, treasury to release. Holding all
 * three is what lets one person run the flow end to end; the previous shape
 * invented three colleagues to satisfy the gates, which meant every signature
 * on every record was a name the app made up — and two people sharing a device
 * would have signed as the same fiction, so the SoD comparison compared an
 * alias against itself.
 *
 * `system` is deliberately absent: that role belongs to the extractor, and a
 * person wearing it would bypass the name-based split on every record.
 */
export const OPERATOR_ROLES: ActorRole[] = ["processor", "approver", "treasury"];

/**
 * What the audit trail says before the operator has given a name. Not a person
 * the app made up — the honest "this was me, and I have not said who". Settings
 * collects the real name; until then nothing is invented.
 */
export const UNNAMED_OPERATOR = "You";

/** The operator's own name, trimmed, or the honest fallback when unset. */
export function operatorName(profile?: Pick<BusinessProfile, "operatorName"> | undefined): string {
  return profile?.operatorName?.trim() || UNNAMED_OPERATOR;
}

/**
 * The one actor this install signs as. Every write path and every action button
 * resolves through here, so a record can only ever be signed by the person
 * running the app.
 */
export function operatorActor(profile?: Pick<BusinessProfile, "operatorName"> | undefined): Actor {
  return { name: operatorName(profile), roles: [...OPERATOR_ROLES] };
}
