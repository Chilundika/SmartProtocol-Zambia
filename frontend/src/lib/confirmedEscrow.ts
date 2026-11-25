/**
 * Shared rules for a Stellar transaction that has already reached SUCCESS.
 * The audit id uses the parsed number, so a form value of "01" is "1".
 * A later audit or status-refresh failure stays a success.
 */

export function canonicalEscrowAuditId(parsedEscrowId: number): string {
  if (!Number.isSafeInteger(parsedEscrowId) || parsedEscrowId < 0) {
    throw new Error("Escrow ID must be a safe non-negative integer.");
  }
  return String(parsedEscrowId);
}

export function auditWarningFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown audit service error.";
}

export function refreshWarningFromError(error: unknown): string {
  const detail =
    error instanceof Error && error.message
      ? error.message
      : "The latest escrow status could not be loaded.";
  return `Status refresh failed. The transaction remains confirmed. ${detail}`;
}

export function confirmedTransactionFeedback(input: {
  auditError?: unknown;
  refreshError?: unknown;
}): {
  kind: "success";
  auditWarning?: string;
  refreshWarning?: string;
} {
  return {
    kind: "success",
    ...(input.auditError !== undefined
      ? { auditWarning: auditWarningFromError(input.auditError) }
      : {}),
    ...(input.refreshError !== undefined
      ? { refreshWarning: refreshWarningFromError(input.refreshError) }
      : {}),
  };
}
