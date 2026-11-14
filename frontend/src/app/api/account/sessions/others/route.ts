import { updateAccountSecurity } from "@/lib/account-security";
export function POST(request: Request) { return updateAccountSecurity(request, "sessions/revoke-others"); }
