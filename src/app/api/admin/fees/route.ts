import { unavailableAdminOperation } from "@/lib/security/unavailable-admin-operation";

export async function GET() {
  return unavailableAdminOperation("fee-configuration");
}

export async function POST() {
  return unavailableAdminOperation("fee-configuration");
}

export async function PUT() {
  return unavailableAdminOperation("fee-configuration");
}

export async function DELETE() {
  return unavailableAdminOperation("fee-configuration");
}
