import type { DashboardTier } from "$lib/server/roles";

declare global {
  namespace App {
    interface Locals {
      user?: {
        id: string;
        username: string;
        globalName: string | null;
        avatarUrl: string;
        bannerUrl: string | null;
        accentColor: number | null;
        tier: DashboardTier;
        roles: string[];
      };
    }
  }
}

declare module "*.md?raw" {
  const content: string;
  export default content;
}

export {};
