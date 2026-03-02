// =============================================================================
// adminapimanager.tsx — Admin-specific API layer
//
// This module is the single import point for all admin components.
// It re-exports the shared guideline types and functions from apigatewaymanager,
// adds the is_admin flag injection that the backend enforces on every admin
// endpoint, and provides the polling helper the upload flow needs.
//
// Backend gold standard: guidelines_management.py, lambda_function.py
//
// ADMIN ENDPOINT SECURITY NOTE:
// Every admin endpoint in lambda_function.py checks `is_admin` in the request
// body (when no Cognito authorizer is configured). The base `request()` helper
// in apigatewaymanager.tsx never injects this flag, so admin calls would hit
// the 403 guard. This module fixes that by maintaining a separate admin
// identity and providing its own request wrapper that always injects
// `is_admin: true` alongside the officer identity.
// =============================================================================

import { REST_API_URL } from './constants';

// Re-export all shared types so admin components import from one place
export type {
  ApiGuideline,
  GuidelinesJson,
  GuidelineRule,
  BackendGuidelineStatus,
  BackendProcessingStatus,
  ApiResponse,
} from './apigatewaymanager';

// Re-export uploadFileToS3 — used by the upload guideline screen
export { uploadFileToS3 } from './apigatewaymanager';

// Normalise base URL — strip trailing slash if present
const API_BASE_URL = REST_API_URL.endsWith('/')
  ? REST_API_URL.slice(0, -1)
  : REST_API_URL;


// =============================================================================
// PROCESSING STATUS CONSTANTS
// Maps the backend processing_status field to a UI-friendly display value.
// Backend values: 'pending' | 'processing' | 'completed' | 'reviewed' | 'failed'
// =============================================================================

export type GuidelineProcessingStatus = 'pending' | 'processing' | 'completed' | 'reviewed' | 'failed';

export type GuidelineDisplayStatus = 'Pending' | 'Processing' | 'Ready for Review' | 'Reviewed' | 'Failed';

const PROCESSING_STATUS_MAP: Record<GuidelineProcessingStatus, GuidelineDisplayStatus> = {
  pending:    'Pending',
  processing: 'Processing',
  completed:  'Ready for Review',
  reviewed:   'Reviewed',
  failed:     'Failed',
};

export function mapGuidelineProcessingStatus(
  status: string
): GuidelineDisplayStatus {
  return PROCESSING_STATUS_MAP[status as GuidelineProcessingStatus] ?? 'Pending';
}


// =============================================================================
// ADMIN IDENTITY
// Set once at app startup after Cognito auth resolves (same timing as
// setOfficerIdentity in apigatewaymanager). Carries the is_admin flag that
// the backend requires on every admin-only endpoint.
// =============================================================================

export interface AdminIdentity {
  officer_id: string;
  officer_name: string;
}

let _adminIdentity: AdminIdentity = { officer_id: '', officer_name: '' };

/** Call once in App.tsx after auth resolves for admin users */
export function setAdminIdentity(identity: AdminIdentity): void {
  _adminIdentity = identity;
}

export function getAdminIdentity(): AdminIdentity {
  return _adminIdentity;
}


// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/** Generic API response wrapper — matches apigatewaymanager shape */
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

/**
 * Admin-specific fetch wrapper.
 * Injects officer identity + is_admin: true into every POST/PUT/DELETE body.
 * Returns { data, error } — never throws.
 */
async function adminRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    let finalOptions = options;

    // Always append officer_id and is_admin as query params so the backend
    // identity extraction finds them regardless of HTTP method or body parsing.
    const separator = path.includes('?') ? '&' : '?';
    const authParams = `officer_id=${encodeURIComponent(_adminIdentity.officer_id)}&is_admin=true`;
    const fullPath = `${path}${separator}${authParams}`;

    if (options.method && options.method !== 'GET') {
      const existingBody = options.body ? JSON.parse(options.body as string) : {};
      finalOptions = {
        ...options,
        body: JSON.stringify({
          officer_id:   _adminIdentity.officer_id,
          officer_name: _adminIdentity.officer_name,
          is_admin:     true,
          ...existingBody,
        }),
      };
    }

    const res = await fetch(`${API_BASE_URL}${fullPath}`, {
      ...finalOptions,
      headers: {
        'Content-Type': 'application/json',
        ...finalOptions.headers,
      },
    });

    if (!res.ok) {
      const errorBody = await res.text();
      return { data: null, error: `HTTP ${res.status}: ${errorBody}` };
    }

    const data: T = await res.json();
    return { data, error: null };

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { data: null, error: message };
  }
}


// =============================================================================
// GUIDELINE TYPES (local — avoids circular import from apigatewaymanager)
// These mirror the shapes defined there exactly.
// =============================================================================

export interface ApiGuideline {
  guideline_id: string;
  version: string;
  description: string;
  uploaded_by: string;
  uploaded_by_name: string;
  created_at: number;           // Unix timestamp (seconds)
  updated_at: number;
  status: 'active' | 'inactive';
  processing_status: GuidelineProcessingStatus;
  pdf_s3_path: string;
  json_s3_path: string;
  error_info: {
    last_error: string | null;
    error_count: number;
  };
  // Only present on GET /guidelines/active
  guidelines_content?: GuidelinesJson | null;
  activated_at?: number;
  activated_by?: string;
  updated_by?: string;
}

export interface GuidelinesJson {
  guidelines: GuidelineRule[];
}

/**
 * The raw shape Bedrock writes to S3 after convert_guidelines.
 * The prompt outputs { "version": "1.0", "rules": [...] } with a different
 * rule schema than the frontend uses internally.
 */
interface BedrockGuidelinesJson {
  version: string;
  rules: BedrockRule[];
}

interface BedrockRule {
  id: number;
  description: string;
  applies_to: string[];
  conditions: string[];
  exceptions: string[];
}

function bedrockToGuidelinesJson(bedrock: BedrockGuidelinesJson): GuidelinesJson {
  return {
    guidelines: bedrock.rules.map(rule => ({
      id:        String(rule.id),
      title:     `Rule ${rule.id}`,
      category:  rule.applies_to.length > 0 ? rule.applies_to.join(', ') : 'General',
      rule_text: rule.description,
    })),
  };
}

/**
 * Detect whether a JSON blob from S3 is the raw Bedrock output shape
 * (has a top-level "rules" array) vs. the saved frontend shape
 * (has a top-level "guidelines" array). Returns a normalised GuidelinesJson
 * regardless of which shape it receives.
 */
export function normaliseGuidelinesJson(raw: any): GuidelinesJson | null {
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw.guidelines)) return raw as GuidelinesJson;
  if (Array.isArray(raw.rules)) return bedrockToGuidelinesJson(raw as BedrockGuidelinesJson);
  return null;
}

export interface GuidelineRule {
  id: string;
  title: string;
  category: string;
  rule_text: string;  // NOTE: backend uses rule_text, frontend ReviewExtractedRules uses ruleText
                      // Map when passing to that component: rule_text → ruleText
}


// =============================================================================
// UPLOAD FLOW
// The full guideline upload sequence is a 3-step async operation:
//   1. POST /guidelines/upload       → get presigned URL + guideline_id
//   2. PUT to S3 presigned URL       → upload the PDF directly
//   3. POST /guidelines/{id}/process → kick off Bedrock PDF→JSON conversion
// After step 3, poll getGuidelineStatus() until processing_status === 'completed'.
// =============================================================================

/**
 * Step 1 — Create a new guideline record and receive a presigned S3 POST URL.
 *
 * → POST /guidelines/upload
 * Body: { description }
 * ← { success, message, guideline_id, upload_url, fields, version }
 *
 * After this call, use uploadFileToS3() from apigatewaymanager with the
 * returned upload_url and fields, then call triggerGuidelineProcessing().
 */
export async function createGuideline(description: string): Promise<ApiResponse<{
  guideline_id: string;
  upload_url: string;
  fields: Record<string, string>;
  version: string;
}>> {
  const result = await adminRequest<{
    success: boolean;
    message: string;
    guideline_id: string;
    upload_url: string;
    fields: Record<string, string>;
    version: string;
  }>('/guidelines/upload', {
    method: 'POST',
    body: JSON.stringify({ description }),
  });

  if (!result.data) return { data: null, error: result.error };

  return {
    data: {
      guideline_id: result.data.guideline_id,
      upload_url:   result.data.upload_url,
      fields:       result.data.fields,
      version:      result.data.version,
    },
    error: null,
  };
}

/**
 * Step 3 — Trigger Bedrock Lambda to convert the uploaded PDF into JSON rules.
 * Call this after the S3 upload (step 2) completes successfully.
 *
 * → POST /guidelines/{guideline_id}/process
 * ← { success, message, guideline_id, processing_status }
 */
export async function triggerGuidelineProcessing(
  guidelineId: string
): Promise<ApiResponse<{ processing_status: GuidelineProcessingStatus }>> {
  const result = await adminRequest<{
    success: boolean;
    message: string;
    guideline_id: string;
    processing_status: GuidelineProcessingStatus;
  }>(`/guidelines/${encodeURIComponent(guidelineId)}/process`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  return {
    data: result.data ? { processing_status: result.data.processing_status } : null,
    error: result.error,
  };
}


// =============================================================================
// POLLING
// =============================================================================

/** How often to check processing status (ms) */
const POLL_INTERVAL_MS = 3000;

/** Maximum total time to wait for processing (ms) — 10 minutes */
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Fetch the current status of a guideline.
 * Used by pollGuidelineUntilReady to check processing_status on each tick.
 *
 * → GET /guidelines/all then filter by guideline_id
 *
 * Note: The backend exposes no single GET /guidelines/{id} endpoint, so we
 * fetch the full list and filter. This is acceptable since admin lists are
 * small. If a dedicated endpoint is added later, swap the implementation here.
 */
export async function getGuidelineStatus(
  guidelineId: string
): Promise<ApiResponse<Pick<ApiGuideline, 'guideline_id' | 'processing_status' | 'status' | 'error_info'>>> {
  const result = await adminRequest<{
    success: boolean;
    count: number;
    active_guideline_id: string | null;
    guidelines: ApiGuideline[];
  }>('/guidelines/all');

  if (!result.data) return { data: null, error: result.error };

  const match = result.data.guidelines.find(g => g.guideline_id === guidelineId);
  if (!match) return { data: null, error: `Guideline not found: ${guidelineId}` };

  return {
    data: {
      guideline_id:      match.guideline_id,
      processing_status: match.processing_status,
      status:            match.status,
      error_info:        match.error_info,
    },
    error: null,
  };
}

/**
 * Poll a guideline's processing_status until it reaches 'completed' or 'failed'.
 *
 * @param guidelineId    The guideline to watch
 * @param onStatusUpdate Optional callback invoked on every poll tick with the
 *                       current processing status — use to drive a progress UI
 * @param signal         Optional AbortSignal — call abort() on component unmount
 *                       to stop the loop cleanly
 *
 * @returns ApiResponse<ApiGuideline> — resolves with the completed guideline
 *          record (including guidelines_content if available), or an error if
 *          processing failed or timed out.
 *
 * Usage:
 *   const controller = new AbortController();
 *   const { data, error } = await pollGuidelineUntilReady(
 *     guidelineId,
 *     (status) => setProcessingStatus(status),
 *     controller.signal
 *   );
 *   // In cleanup: controller.abort();
 */
export async function pollGuidelineUntilReady(
  guidelineId: string,
  onStatusUpdate?: (status: GuidelineProcessingStatus) => void,
  signal?: AbortSignal
): Promise<ApiResponse<ApiGuideline>> {
  const startTime = Date.now();

  while (true) {
    // Respect abort signal
    if (signal?.aborted) {
      return { data: null, error: 'Polling cancelled' };
    }

    // Check timeout
    if (Date.now() - startTime > POLL_TIMEOUT_MS) {
      return { data: null, error: 'Processing timed out after 10 minutes' };
    }

    // Fetch current status
    const { data, error } = await getGuidelineStatus(guidelineId);

    if (error) {
      // Transient network error — keep trying
      console.warn(`[adminapimanager] Poll error for ${guidelineId}: ${error}`);
    } else if (data) {
      onStatusUpdate?.(data.processing_status);

      if (data.processing_status === 'completed') {
        // Fetch the full guideline list one more time to get the complete record
        // including guidelines_content if the backend attaches it to /all
        const allResult = await getAllGuidelines();
        if (allResult.data) {
          const full = allResult.data.guidelines.find(
            g => g.guideline_id === guidelineId
          );
          if (full) return { data: full, error: null };
        }
        // Fallback: return a minimal completed record
        return {
          data: {
            guideline_id:      data.guideline_id,
            processing_status: 'completed',
            status:            data.status,
            error_info:        data.error_info,
            // Required fields — populated properly on next getAllGuidelines call
            version:           '',
            description:       '',
            uploaded_by:       '',
            uploaded_by_name:  '',
            created_at:        0,
            updated_at:        0,
            pdf_s3_path:       '',
            json_s3_path:      '',
          },
          error: null,
        };
      }

      if (data.processing_status === 'failed') {
        const reason = data.error_info?.last_error ?? 'Processing failed';
        return { data: null, error: reason };
      }
    }

    // Wait before next poll tick
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, POLL_INTERVAL_MS);
      // Hook into abort signal so we don't wait a full tick after abort
      signal?.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Polling cancelled'));
      });
    }).catch(() => {
      // Swallow the abort rejection — outer loop checks signal.aborted
    });
  }
}


// =============================================================================
// DASHBOARD — LIST & MANAGE
// =============================================================================

/**
 * Fetch all guidelines with metadata. Drives the admin dashboard table.
 *
 * → GET /guidelines/all
 * ← { success, count, active_guideline_id, guidelines: ApiGuideline[] }
 */
export async function getAllGuidelines(): Promise<ApiResponse<{
  active_guideline_id: string | null;
  guidelines: ApiGuideline[];
}>> {
  // GET request — no body injection needed, but officer_id must be in query
  // for the backend identity extraction fallback. Append as query param.
  const result = await adminRequest<{
    success: boolean;
    count: number;
    active_guideline_id: string | null;
    guidelines: ApiGuideline[];
  }>('/guidelines/all');

  if (!result.data) return { data: null, error: result.error };

  return {
    data: {
      active_guideline_id: result.data.active_guideline_id,
      guidelines:          result.data.guidelines,
    },
    error: null,
  };
}

/**
 * Update the JSON rules for a guideline after the admin has reviewed/edited them.
 * The backend saves the JSON to S3 and sets processing_status to 'completed'.
 *
 * → PUT /guidelines/{guideline_id}
 * Body: { guidelines_json: GuidelinesJson }
 * ← { success, message, guideline_id, version }
 *
 * IMPORTANT: The GuidelinesJson object must have a top-level 'guidelines' array
 * — the backend validates this and returns 400 if it's missing.
 *
 * Rule shape mapping:
 *   Frontend ReviewExtractedRules uses  { id, title, category, ruleText }
 *   Backend GuidelineRule uses          { id, title, category, rule_text }
 *   Map ruleText → rule_text before calling this function.
 */
export async function updateGuidelineRules(
  guidelineId: string,
  guidelinesJson: GuidelinesJson
): Promise<ApiResponse<{ guideline_id: string; version: string }>> {
  const result = await adminRequest<{
    success: boolean;
    message: string;
    guideline_id: string;
    version: string;
  }>(`/guidelines/${encodeURIComponent(guidelineId)}`, {
    method: 'PUT',
    body: JSON.stringify({ guidelines_json: guidelinesJson }),
  });

  if (!result.data) return { data: null, error: result.error };

  return {
    data: { guideline_id: result.data.guideline_id, version: result.data.version },
    error: null,
  };
}

/**
 * Set a guideline as active. Atomically deactivates all others on the backend.
 * The guideline must have processing_status === 'completed' — the backend
 * enforces this and returns 400 if not met.
 *
 * → PUT /guidelines/{guideline_id}/activate
 * ← { success, message, guideline_id, version }
 */
export async function activateGuideline(
  guidelineId: string
): Promise<ApiResponse<{ guideline_id: string; version: string }>> {
  const result = await adminRequest<{
    success: boolean;
    message: string;
    guideline_id: string;
    version: string;
  }>(`/guidelines/${encodeURIComponent(guidelineId)}/activate`, {
    method: 'PUT',
    body: JSON.stringify({}),
  });

  if (!result.data) return { data: null, error: result.error };

  return {
    data: { guideline_id: result.data.guideline_id, version: result.data.version },
    error: null,
  };
}

/**
 * Delete a guideline. The backend prevents deletion of the active guideline
 * and returns 400 — surface this error to the admin.
 *
 * → DELETE /guidelines/{guideline_id}
 * ← { success, message, guideline_id }
 */
export async function deleteGuideline(
  guidelineId: string
): Promise<ApiResponse<{ deleted: boolean }>> {
  const result = await adminRequest<{
    success: boolean;
    message: string;
    guideline_id: string;
  }>(`/guidelines/${encodeURIComponent(guidelineId)}`, {
    method: 'DELETE',
  });

  return {
    data: result.data?.success ? { deleted: true } : null,
    error: result.error,
  };
}


/**
 * Fetch the extracted rules for any completed or reviewed guideline.
 * Handles both the raw Bedrock output shape ({ rules: [...] }) and the saved
 * frontend shape ({ guidelines: [...] }) transparently via normaliseGuidelinesJson.
 *
 * → GET /guidelines/{guideline_id}/rules
 * ← { success, guideline_id, guidelines_content, processing_status, version, description }
 *
 * @param guidelineId  The guideline_id to fetch rules for
 */
export async function fetchGuidelineRules(
  guidelineId: string
): Promise<ApiResponse<FrontendRule[]>> {
  const result = await adminRequest<{
    success: boolean;
    guideline_id: string;
    guidelines_content: any;
    processing_status: string;
    version: string;
    description: string;
  }>(`/guidelines/${encodeURIComponent(guidelineId)}/rules`);

  if (result.error || !result.data) {
    return { data: null, error: result.error ?? 'Failed to fetch guideline rules' };
  }

  const { guidelines_content } = result.data;

  const normalised = normaliseGuidelinesJson(guidelines_content);
  if (!normalised?.guidelines?.length) {
    return { data: null, error: 'Guidelines JSON is empty or missing a rules/guidelines array' };
  }

  return { data: extractFrontendRules(normalised), error: null };
}


// =============================================================================
// UTILITY — RULE SHAPE MAPPING
// ReviewExtractedRules (frontend) uses camelCase `ruleText`.
// The backend and GuidelineRule type use snake_case `rule_text`.
// Use these helpers at the boundary so components stay clean.
// =============================================================================

/** Shape used by ReviewExtractedRules component */
export interface FrontendRule {
  id: string;
  title: string;
  category: string;
  ruleText: string;
}

/** Convert backend GuidelineRule → FrontendRule for display components */
export function toFrontendRule(rule: GuidelineRule): FrontendRule {
  return {
    id:       rule.id,
    title:    rule.title,
    category: rule.category,
    ruleText: rule.rule_text,
  };
}

/** Convert FrontendRule → backend GuidelineRule for save/update calls */
export function toBackendRule(rule: FrontendRule): GuidelineRule {
  return {
    id:        rule.id,
    title:     rule.title,
    category:  rule.category,
    rule_text: rule.ruleText,
  };
}

/**
 * Convert a full GuidelinesJson (backend) to a FrontendRule array for display.
 * Handles both the raw Bedrock output shape ({ rules: [...] }) and the saved
 * frontend shape ({ guidelines: [...] }) transparently.
 */
export function extractFrontendRules(guidelinesJson: any): FrontendRule[] {
  const normalised = normaliseGuidelinesJson(guidelinesJson);
  if (!normalised) return [];
  return normalised.guidelines.map(toFrontendRule);
}

/**
 * Convert an edited FrontendRule array back to a GuidelinesJson payload
 * ready to pass to updateGuidelineRules().
 */
export function buildGuidelinesJson(rules: FrontendRule[]): GuidelinesJson {
  return { guidelines: rules.map(toBackendRule) };
}