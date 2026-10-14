import { unavailableAdminOperation } from "@/lib/security/unavailable-admin-operation";

export async function GET() {
  return unavailableAdminOperation("market-management");
}

export async function POST() {
  return unavailableAdminOperation("market-management");
}

export async function PUT() {
  return unavailableAdminOperation("market-management");
}

export async function DELETE() {
  return unavailableAdminOperation("market-management");
}
