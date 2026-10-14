import { NextResponse } from "next/server";

type AdminOperation = "kyc-review" | "fee-configuration" | "market-management";

const messages: Record<AdminOperation, string> = {
  "kyc-review": "KYC review is unavailable until persistent KYC records, document access controls, and administrator authorization are connected.",
  "fee-configuration": "Fee configuration is unavailable until durable fee policy storage, change approval, and administrator authorization are connected.",
  "market-management": "Market management is unavailable until durable market metadata, validation, audit logging, and administrator authorization are connected.",
};

/** Prevent unimplemented admin endpoints from leaking fake records or claiming mutations succeeded. */
export function unavailableAdminOperation(operation: AdminOperation) {
  return NextResponse.json(
    { success: false, error: { code: "ADMIN_OPERATION_NOT_CONFIGURED", message: messages[operation] } },
    { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
  );
}
