import { unavailableAdminOperation } from "@/lib/security/unavailable-admin-operation";

export async function GET() {
  return unavailableAdminOperation("kyc-review");
}

export async function POST() {
  return unavailableAdminOperation("kyc-review");
}

export async function PUT() {
  return unavailableAdminOperation("kyc-review");
}

export async function DELETE() {
  return unavailableAdminOperation("kyc-review");
}
