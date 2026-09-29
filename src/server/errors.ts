export type ErrorCode =
  | "bad_request"
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "account_suspended"
  | "csrf_rejected"
  | "not_found"
  | "conflict"
  | "gone"
  | "payload_too_large"
  | "file_too_large"
  | "quota_exceeded"
  | "file_limit_exceeded"
  | "blocked_file_type"
  | "checksum_mismatch"
  | "incomplete_upload"
  | "upload_closed"
  | "password_required"
  | "invalid_password"
  | "rate_limited"
  | "maintenance"
  | "range_not_satisfiable"
  | "scan_pending"
  | "quarantined"
  | "registration_closed"
  | "plan_required"
  | "plan_limit_reached"
  | "two_factor_required"
  | "invalid_code"
  | "feature_disabled"
  | "internal_error";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(status: number, code: ErrorCode, message: string, opts?: { details?: unknown; headers?: Record<string, string> }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = opts?.details;
    this.headers = opts?.headers;
  }
}

export const Errors = {
  badRequest: (message = "The request is not valid.", details?: unknown) => new ApiError(400, "bad_request", message, { details }),
  validation: (message = "Some fields are invalid.", details?: unknown) => new ApiError(422, "validation_error", message, { details }),
  unauthorized: (message = "Sign in to continue.") => new ApiError(401, "unauthorized", message),
  forbidden: (message = "You don't have access to this.") => new ApiError(403, "forbidden", message),
  suspended: () => new ApiError(403, "account_suspended", "This account has been suspended. Contact the administrator."),
  csrf: () => new ApiError(403, "csrf_rejected", "The request origin was rejected."),
  notFound: (message = "That item doesn't exist or you don't have access to it.") => new ApiError(404, "not_found", message),
  conflict: (message: string, details?: unknown) => new ApiError(409, "conflict", message, { details }),
  gone: (message = "This link is no longer available.") => new ApiError(410, "gone", message),
  tooLarge: (message = "The request body is too large.") => new ApiError(413, "payload_too_large", message),
  fileTooLarge: (limit: string) => new ApiError(413, "file_too_large", `This file is larger than your limit of ${limit}.`),
  quota: (message: string) => new ApiError(507, "quota_exceeded", message),
  fileLimit: (message: string) => new ApiError(403, "file_limit_exceeded", message),
  blockedType: (ext: string) => new ApiError(415, "blocked_file_type", `Files of type ".${ext}" can't be uploaded here.`),
  checksum: (message = "The file's checksum did not match.") => new ApiError(422, "checksum_mismatch", message),
  incomplete: (missing: number[]) => new ApiError(409, "incomplete_upload", "Some chunks have not been received yet.", { details: { missing: missing.slice(0, 1000) } }),
  uploadClosed: (message = "This upload is no longer accepting data.") => new ApiError(409, "upload_closed", message),
  passwordRequired: () => new ApiError(401, "password_required", "This link is password protected."),
  invalidPassword: () => new ApiError(401, "invalid_password", "That password isn't correct."),
  rateLimited: (retryAfterSec: number, message = "Too many requests. Please slow down and try again shortly.") =>
    new ApiError(429, "rate_limited", message, { headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSec))) }, details: { retryAfter: Math.ceil(retryAfterSec) } }),
  maintenance: (message: string) => new ApiError(503, "maintenance", message, { headers: { "Retry-After": "300" } }),
  range: (size: number) => new ApiError(416, "range_not_satisfiable", "The requested range can't be served.", { headers: { "Content-Range": `bytes */${size}` } }),
  scanPending: () => new ApiError(423, "scan_pending", "This file is still being scanned. Try again in a moment."),
  quarantined: () => new ApiError(403, "quarantined", "This file has been blocked by the security scan."),
  planRequired: (feature: string, label: string, requiredPlan: string | null) =>
    new ApiError(403, "plan_required", `${label} isn't included in your current plan.${requiredPlan ? ` It's available on ${requiredPlan}.` : ""}`, { details: { feature, requiredPlan } }),
  planLimit: (limit: string, label: string, max: number) =>
    new ApiError(403, "plan_limit_reached", `You've reached the ${label.toLowerCase()} limit of your plan (${max}). Remove one or upgrade to add more.`, { details: { limit, max } }),
  featureDisabled: (label: string) => new ApiError(403, "feature_disabled", `${label} has been turned off by the administrator.`),
  twoFactorRequired: () => new ApiError(401, "two_factor_required", "Enter the 6-digit code from your authenticator app, or a backup code."),
  invalidCode: (message = "That code isn't valid. Check the code and try again.") => new ApiError(401, "invalid_code", message),
  registrationClosed: () => new ApiError(403, "registration_closed", "Registration is currently closed."),
  internal: () => new ApiError(500, "internal_error", "Something went wrong on our side. Please try again."),
};
