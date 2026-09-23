export type OrgRole = "processor" | "approver" | "treasury";

export type AuthProfile = {
  id: string;
  displayName: string;
};

export type OrgMember = {
  orgId: string;
  userId: string;
  isOwner: boolean;
  roles: OrgRole[];
};

export type SessionOrg = {
  orgId: string;
  orgName: string;
  isOwner: boolean;
  roles: OrgRole[];
  memberCount: number;
};
