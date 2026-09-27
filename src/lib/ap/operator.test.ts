import { describe, expect, it } from "bun:test";
import {
  operatorActor,
  operatorActorWithRole,
  operatorName,
  OPERATOR_ROLES,
  UNNAMED_OPERATOR,
} from "./operator";
import { EMPTY_BUSINESS_PROFILE } from "./types";

describe("the one operator", () => {
  it("signs with the name the operator configured, trimmed", () => {
    expect(operatorActor({ operatorName: "  Sam de Vries  " })).toEqual({
      name: "Sam de Vries",
      roles: [...OPERATOR_ROLES],
    });
    expect(operatorName({ ...EMPTY_BUSINESS_PROFILE, operatorName: "Sam de Vries" })).toBe(
      "Sam de Vries",
    );
  });

  it("invents nobody when no name is configured", () => {
    // The point of the module: an unset name stays honest. The app used to sign
    // as an invented processor and an invented approver, so every record carried
    // a signature from a colleague who does not exist.
    expect(operatorName(undefined)).toBe(UNNAMED_OPERATOR);
    expect(operatorName({ operatorName: "" })).toBe(UNNAMED_OPERATOR);
    expect(operatorName({ operatorName: "   " })).toBe(UNNAMED_OPERATOR);
    expect(operatorActor(undefined).name).toBe(UNNAMED_OPERATOR);
  });

  it("holds every human role the flow needs — and not the machine's", () => {
    const actor = operatorActor({ operatorName: "Sam de Vries" });
    expect(actor.roles).toEqual(["processor", "approver", "treasury"]);
    // `system` is the extractor's. A person wearing it would bypass the
    // name-based split on every record, which is the rule this install keeps.
    expect(actor.roles).not.toContain("system");
  });

  it("resolves one identity, so two callers cannot disagree about who signed", () => {
    const profile = { operatorName: "Sam de Vries" };
    expect(operatorActor(profile)).toEqual(operatorActor(profile));
    // Two callers reading the same profile get the same actor, name and all.
    expect(operatorActor(profile)).toEqual({ name: "Sam de Vries", roles: [...OPERATOR_ROLES] });
  });

  it("narrows to the action role without inventing another identity", () => {
    expect(operatorActorWithRole("approver", { operatorName: "Sam de Vries" })).toEqual({
      name: "Sam de Vries",
      roles: ["approver"],
    });
  });
});
