import {
  BriefcaseBusiness,
  Building2,
  Layers3,
  UsersRound,
} from "lucide-react";
import type { OrganizationIcon } from "admin_domain/common";

export function OrganizationIconView({ icon }: { icon: OrganizationIcon }) {
  const Icon =
    icon === "briefcase"
      ? BriefcaseBusiness
      : icon === "layers"
        ? Layers3
        : icon === "users"
          ? UsersRound
          : Building2;
  return <Icon aria-hidden="true" />;
}
