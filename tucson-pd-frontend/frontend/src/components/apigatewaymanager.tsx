// =============================================================================
// apigatewaymanager.tsx — Central API Gateway client
// All types and request/response shapes match the backend exactly.
// Backend gold standard: case_management.py, presigned_urls.py,
//                        guidelines_management.py, lambda_function.py
// =============================================================================

import { REST_API_URL } from './constants';

// Normalise base URL — strip trailing slash if present
const API_BASE_URL = REST_API_URL.endsWith('/')
  ? REST_API_URL.slice(0, -1)
  : REST_API_URL;


// =============================================================================
// BACKEND STATUS CONSTANTS
// These are the raw string values stored in DynamoDB.
// =============================================================================

export type BackendCaseStatus =
  | 'CASE_CREATED'
  | 'INTAKE_UPLOADED'
  | 'UNREDACTED_UPLOADED'
  | 'PROCESSING'
  | 'REVIEW_READY'
  | 'REVIEWING'
  | 'APPLYING_REDACTIONS'
  | 'COMPLETED'
  | 'CLOSED'
  | 'FAILED';

export type BackendGuidelineStatus = 'active' | 'inactive';
export type BackendProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';


// =============================================================================
// FRONTEND DISPLAY STATUS
// Collapsed from the 10 backend statuses into 4 UI states.
// =============================================================================

export type DisplayStatus = 'Not Started' | 'In Progress' | 'Review Now' | 'Completed';

const STATUS_MAP: Record<string, DisplayStatus> = {
  CASE_CREATED:         'Not Started',
  INTAKE_UPLOADED:      'Not Started',
  UNREDACTED_UPLOADED:  'In Progress',
  PROCESSING:           'In Progress',
  REVIEW_READY:         'Review Now',
  REVIEWING:            'Review Now',
  APPLYING_REDACTIONS:  'In Progress',
  COMPLETED:            'Completed',
  CLOSED:               'Completed',
  FAILED:               'Not Started',
};

export function mapBackendStatus(backendStatus: string): DisplayStatus {
  return STATUS_MAP[backendStatus] ?? 'Not Started';
}


// =============================================================================
// TYPES — matched exactly to DynamoDB records
// =============================================================================

/** S3 path map stored on every case record */
export interface CaseS3Paths {
  intake_form: string | null;
  unredacted_doc: string | null;
  redaction_proposals: string | null;
  edited_redactions: string | null;
  redacted_doc: string | null;
}

/** Metadata counters updated by the Bedrock Lambda */
export interface CaseMetadata {
  total_pages: number | null;
  total_redactions_proposed: number | null;
  total_redactions_applied: number | null;
  /** Path written by the Lambda — may be here instead of s3_paths.redacted_doc */
  redacted_doc_path?: string | null;
  redaction_proposals_path?: string | null;
  document_summary?: string | null;
  guideline_id?: string | null;
  guideline_version?: string | null;
  total_redactions_skipped?: number | null;
  stage?: string | null;
}

/** Error tracking block on the case record */
export interface CaseErrorInfo {
  last_error: string | null;
  error_count: number;
  last_error_timestamp: number | null;
}

/** Full case record as stored in DynamoDB and returned by the backend */
export interface ApiCase {
  case_id: string;
  officer_id: string;
  officer_name: string;
  status: BackendCaseStatus;
  created_at: number;       // Unix timestamp (seconds)
  updated_at: number;       // Unix timestamp (seconds)
  s3_paths: CaseS3Paths;
  metadata: CaseMetadata;
  error_info: CaseErrorInfo;
}

/** Guideline record as stored in DynamoDB */
export interface ApiGuideline {
  guideline_id: string;
  version: string;                          // e.g. "2024-01-15_10-30-00"
  description: string;
  uploaded_by: string;                      // admin officer_id
  uploaded_by_name: string;
  created_at: number;                       // Unix timestamp (seconds)
  updated_at: number;
  status: BackendGuidelineStatus;           // 'active' | 'inactive'
  processing_status: BackendProcessingStatus; // 'pending' | 'processing' | 'completed' | 'failed'
  pdf_s3_path: string;                      // s3://bucket/guidelines/documents/{id}.pdf
  json_s3_path: string;                     // s3://bucket/guidelines/processed/{id}.json
  error_info: {
    last_error: string | null;
    error_count: number;
  };
  // Only present when fetched via GET /guidelines/active
  guidelines_content?: GuidelinesJson | null;
  activated_at?: number;
  activated_by?: string;
  updated_by?: string;
}

/**
 * The structured JSON document stored in S3 for an active guideline.
 * The LLM extracts rules from the uploaded PDF into this shape.
 */
export interface GuidelinesJson {
  guidelines: GuidelineRule[];
}

export interface GuidelineRule {
  id: string;
  title: string;
  category: string;
  rule_text: string;
}

/** Bounding box coordinates for a redaction region on a PDF page */
export interface RedactionBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A single proposed redaction item as written by the Bedrock Lambda.
 * `approved` is a frontend-only field added during officer review — never
 * present in the original S3 JSON, stripped before re-upload.
 */
export interface RedactionItem {
  page: number;
  text: string;
  instance: number;
  rules: string[];           // Rule IDs referencing GuidelineRule.id
  bbox_nova: RedactionBBox;  // Coordinates in Nova's coordinate space
  bbox_pts: RedactionBBox;   // Coordinates in PDF point space
  approved?: boolean;        // Frontend-only: set during review, stripped on submit
}

/** Top-level shape of the redaction_proposals JSON stored in S3 */
export interface RedactionProposalsJson {
  case_id: string;
  total_pages: number;
  redactions: RedactionItem[];
}

/** Response shape from POST /presigned-url/upload */
export interface UploadPresignedResponse {
  upload_url: string;
  fields: Record<string, string>;   // Must be included in FormData before the file
  s3_path: string;                  // Full s3://bucket/key path for recording on the case
}

/** Generic API response wrapper used by all functions in this module */
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}


// =============================================================================
// OFFICER IDENTITY
// Set once at app startup after Cognito auth resolves.
// Auto-injected into every POST/PUT/DELETE request body.
// =============================================================================

export interface OfficerIdentity {
  officer_id: string;
  officer_name: string;
}

let _identity: OfficerIdentity = { officer_id: '', officer_name: '' };

/** Call once in App.tsx after auth resolves, before any API calls */
export function setOfficerIdentity(identity: OfficerIdentity): void {
  _identity = identity;
}

export function getOfficerIdentity(): OfficerIdentity {
  return _identity;
}


// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Central fetch wrapper for all JSON API calls.
 * - Injects officer identity into POST/PUT/DELETE bodies automatically
 * - Returns { data, error } — never throws
 */
async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    let finalOptions = options;

    // Inject identity into every mutating request unconditionally.
    // If officer_id is empty the backend returns 401 — correct behaviour.
    // Previously gated on _identity.officer_id being truthy which silently
    // skipped injection and sent requests with no officer_id at all.
    if (options.method && options.method !== 'GET') {
      const existingBody = options.body ? JSON.parse(options.body as string) : {};
      finalOptions = {
        ...options,
        body: JSON.stringify({
          officer_id: _identity.officer_id,
          officer_name: _identity.officer_name,
          ...existingBody,
        }),
      };
    }

    const res = await fetch(`${API_BASE_URL}${path}`, {
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

/**
 * Upload a file directly to S3 using a presigned POST URL.
 *
 * The backend uses generate_presigned_post which requires a multipart/form-data
 * POST — NOT a PUT. All fields from the presigned response must be appended to
 * the FormData before the file, in order.
 *
 * Uses XMLHttpRequest instead of fetch so upload progress can be tracked.
 *
 * @param presignedUrl  The S3 POST URL from UploadPresignedResponse.upload_url
 * @param fields        The form fields from UploadPresignedResponse.fields
 * @param file          The File object to upload
 * @param onProgress    Optional callback receiving 0–100 upload percentage
 */
export function uploadFileToS3(
  presignedUrl: string,
  fields: Record<string, string>,
  file: File,
  onProgress?: (percent: number) => void
): Promise<ApiResponse<null>> {
  return new Promise((resolve) => {
    const formData = new FormData();

    // Fields must come before the file — S3 requirement
    Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', presignedUrl);

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve({ data: null, error: null });
      } else {
        // DEBUG: log full S3 error XML to console so we can diagnose the rejection
        console.error('[uploadFileToS3] S3 upload failed (onload)');
        console.error('  Status:', xhr.status);
        console.error('  Response body (S3 error XML):', xhr.responseText);
        console.error('  All response headers:', xhr.getAllResponseHeaders());
        resolve({ data: null, error: `S3 upload failed: HTTP ${xhr.status} — ${xhr.responseText}` });
      }
    };

    xhr.onerror = () => {
      // onerror fires when the browser blocks the request (e.g. CORS preflight rejection)
      // xhr.responseText will be empty in this case — check the Network tab for the OPTIONS request
      console.error('[uploadFileToS3] S3 upload failed (onerror — likely CORS preflight rejection)');
      console.error('  Status:', xhr.status);
      console.error('  Response:', xhr.responseText);
      console.error('  Check the Network tab: look for a failing OPTIONS request to S3');
      console.error('  Presigned URL:', presignedUrl);
      console.error('  Fields sent:', JSON.stringify(fields));
      resolve({ data: null, error: `S3 upload failed: network error — see console for details` });
    };

    xhr.send(formData);
  });
}


// =============================================================================
// CASES
// =============================================================================

/**
 * Create a new case record in DynamoDB.
 * Officer identity is injected automatically — no payload needed.
 * → POST /cases
 * ← { success, message, case: ApiCase }
 */
export async function createCase(): Promise<ApiResponse<ApiCase>> {
  const result = await request<{ success: boolean; message: string; case: ApiCase }>(
    '/cases',
    { method: 'POST', body: JSON.stringify({}) }
  );
  return { data: result.data?.case ?? null, error: result.error };
}

/**
 * Fetch all cases belonging to the given officer.
 * Uses the officer-index GSI.
 * → GET /cases?officer_id={id}
 * ← { success, count, cases: ApiCase[] }
 */
export async function getCasesByOfficer(
  officerId: string
): Promise<ApiResponse<ApiCase[]>> {
  const result = await request<{ success: boolean; count: number; cases: ApiCase[] }>(
    `/cases?officer_id=${encodeURIComponent(officerId)}`
  );
  return { data: result.data?.cases ?? null, error: result.error };
}

/**
 * Fetch all cases NOT belonging to the given officer.
 * Used for the "Other Cases" dashboard tab.
 * → GET /cases?officer_id={id}&exclude_officer_id={id}
 * ← { success, count, cases: ApiCase[] }
 */
export async function getOtherCases(
  excludeOfficerId: string
): Promise<ApiResponse<ApiCase[]>> {
  const result = await request<{ success: boolean; count: number; cases: ApiCase[] }>(
    `/cases?officer_id=${encodeURIComponent(excludeOfficerId)}&exclude_officer_id=${encodeURIComponent(excludeOfficerId)}`
  );
  return { data: result.data?.cases ?? null, error: result.error };
}

/**
 * Fetch a single case by ID.
 * → GET /cases/{case_id}
 * ← { success, case: ApiCase }
 */
export async function getCaseById(
  caseId: string
): Promise<ApiResponse<ApiCase>> {
  const result = await request<{ success: boolean; case: ApiCase }>(
    `/cases/${encodeURIComponent(caseId)}?officer_id=${encodeURIComponent(_identity.officer_id)}`
  );
  return { data: result.data?.case ?? null, error: result.error };
}

/**
 * Update case status.
 * Pass the raw backend status constant (e.g. 'INTAKE_UPLOADED').
 * May trigger the Bedrock Lambda asynchronously if transitioning to
 * UNREDACTED_UPLOADED.
 * → PUT /cases/{case_id}/status
 * Body: { new_status: string }
 * ← { success, message, case: ApiCase }
 */
export async function updateCaseStatus(
  caseId: string,
  newStatus: BackendCaseStatus
): Promise<ApiResponse<ApiCase>> {
  const result = await request<{ success: boolean; message: string; case: ApiCase }>(
    `/cases/${encodeURIComponent(caseId)}/status`,
    {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus }),
    }
  );
  return { data: result.data?.case ?? null, error: result.error };
}

/**
 * Record an S3 path on the case after a successful upload.
 * path_type must be one of the keys in CaseS3Paths.
 * → PUT /cases/{case_id}/s3-path
 * Body: { path_type, s3_path }
 * ← { success, message, case: ApiCase }
 */
export async function updateCaseS3Path(
  caseId: string,
  pathType: keyof CaseS3Paths,
  s3Path: string
): Promise<ApiResponse<ApiCase>> {
  const result = await request<{ success: boolean; message: string; case: ApiCase }>(
    `/cases/${encodeURIComponent(caseId)}/s3-path`,
    {
      method: 'PUT',
      body: JSON.stringify({ path_type: pathType, s3_path: s3Path }),
    }
  );
  return { data: result.data?.case ?? null, error: result.error };
}

/**
 * Delete a case and all its associated S3 files.
 * Officer must own the case — enforced by the backend.
 * → DELETE /cases/{case_id}
 * ← { success, message, case_id }
 */
export async function deleteCase(
  caseId: string
): Promise<ApiResponse<{ deleted: boolean }>> {
  const result = await request<{ success: boolean; message: string; case_id: string }>(
    `/cases/${encodeURIComponent(caseId)}`,
    { method: 'DELETE' }
  );
  return {
    data: result.data?.success ? { deleted: true } : null,
    error: result.error,
  };
}


// =============================================================================
// PRESIGNED URLS
// =============================================================================

/**
 * Get a presigned POST URL for uploading a file directly to S3.
 * file_type must be 'intake_form' | 'unredacted_doc' | 'edited_redactions'
 * → POST /presigned-url/upload
 * Body: { case_id, file_type }
 * ← { success, upload_url, fields, s3_path }
 *
 * After calling this, use uploadFileToS3() with the returned url, fields, and file.
 * Then call updateCaseS3Path() with the returned s3_path.
 */
export async function getUploadPresignedUrl(
  caseId: string,
  fileType: 'intake_form' | 'unredacted_doc' | 'edited_redactions'
): Promise<ApiResponse<UploadPresignedResponse>> {
  const result = await request<{
    success: boolean;
    upload_url: string;
    fields: Record<string, string>;
    s3_path: string;
  }>('/presigned-url/upload', {
    method: 'POST',
    body: JSON.stringify({ case_id: caseId, file_type: fileType }),
  });

  if (!result.data) return { data: null, error: result.error };

  return {
    data: {
      upload_url: result.data.upload_url,
      fields: result.data.fields,
      s3_path: result.data.s3_path,
    },
    error: null,
  };
}

/**
 * Get a presigned GET URL for downloading a file from S3.
 * file_type must be 'intake_form' | 'unredacted_doc' | 'redaction_proposals' | 'redacted_doc'
 * → POST /presigned-url/download
 * Body: { case_id, file_type }
 * ← { success, download_url }
 */
export async function getDownloadPresignedUrl(
  caseId: string,
  fileType: 'intake_form' | 'unredacted_doc' | 'redaction_proposals' | 'edited_redactions' | 'redacted_doc'
): Promise<ApiResponse<string>> {
  const result = await request<{ success: boolean; download_url: string }>(
    '/presigned-url/download',
    {
      method: 'POST',
      body: JSON.stringify({ case_id: caseId, file_type: fileType }),
    }
  );
  return {
    data: result.data?.download_url ?? null,
    error: result.error,
  };
}


// =============================================================================
// REDACTION PROPOSALS
// =============================================================================

/**
 * Fetch the redaction proposals JSON for a case directly from S3.
 * Gets a presigned download URL from the backend, then fetches the JSON from S3.
 * Case should be in REVIEW_READY or REVIEWING status before calling.
 *
 * → internally: POST /presigned-url/download → GET {presigned_s3_url}
 * ← parsed RedactionProposalsJson
 */
export async function getRedactionProposals(
  caseId: string
): Promise<ApiResponse<RedactionProposalsJson>> {
  const urlResult = await getDownloadPresignedUrl(caseId, 'redaction_proposals');
  if (!urlResult.data) return { data: null, error: urlResult.error };

  try {
    const res = await fetch(urlResult.data);
    if (!res.ok) return { data: null, error: `S3 fetch failed: HTTP ${res.status}` };
    const json: RedactionProposalsJson = await res.json();
    return { data: json, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { data: null, error: message };
  }
}

/**
 * Fetch the final edited redactions JSON for a completed case directly from S3.
 * Same structure as redaction proposals — use after status reaches COMPLETED.
 *
 * → internally: POST /presigned-url/download → GET {presigned_s3_url}
 * ← parsed RedactionProposalsJson
 */
export async function getEditedRedactions(
  caseId: string
): Promise<ApiResponse<RedactionProposalsJson>> {
  const urlResult = await getDownloadPresignedUrl(caseId, 'edited_redactions');
  if (!urlResult.data) return { data: null, error: urlResult.error };

  try {
    const res = await fetch(urlResult.data);
    if (!res.ok) return { data: null, error: `S3 fetch failed: HTTP ${res.status}` };
    const json: RedactionProposalsJson = await res.json();
    return { data: json, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { data: null, error: message };
  }
}

/**
 * Upload the officer-edited redactions JSON back to S3, record the S3 path on
 * the case, then transition to APPLYING_REDACTIONS to trigger the Bedrock Lambda.
 *
 * The `approved` field on each RedactionItem is stripped before upload — it is
 * a frontend-only review flag and must not be persisted to S3.
 *
 * Flow:
 *   1. Strip frontend-only fields and serialize to a File Blob
 *   2. POST /presigned-url/upload → get presigned S3 POST URL
 *   3. Upload Blob to S3 via uploadFileToS3()
 *   4. PUT /cases/{case_id}/s3-path to record edited_redactions path
 *   5. PUT /cases/{case_id}/status → APPLYING_REDACTIONS (triggers Bedrock Lambda)
 *
 * ← updated ApiCase after status transition
 */
export async function submitEditedRedactions(
  caseId: string,
  redactionsJson: RedactionProposalsJson,
  onProgress?: (percent: number) => void
): Promise<ApiResponse<ApiCase>> {
  // Step 1: Strip frontend-only `approved` flag before persisting
  const cleanedJson: RedactionProposalsJson = {
    ...redactionsJson,
    redactions: redactionsJson.redactions.map(({ approved: _dropped, ...rest }) => rest),
  };

  const blob = new Blob([JSON.stringify(cleanedJson, null, 2)], { type: 'application/json' });
  const file = new File([blob], `edited_redactions_${caseId}.json`, { type: 'application/json' });

  // Step 2: Get presigned upload URL
  const urlResult = await getUploadPresignedUrl(caseId, 'edited_redactions');
  if (!urlResult.data) return { data: null, error: urlResult.error };

  // Step 3: Upload to S3
  const uploadResult = await uploadFileToS3(
    urlResult.data.upload_url,
    urlResult.data.fields,
    file,
    onProgress
  );
  if (uploadResult.error) return { data: null, error: uploadResult.error };

  // Step 4: Record S3 path on the case
  const pathResult = await updateCaseS3Path(caseId, 'edited_redactions', urlResult.data.s3_path);
  if (!pathResult.data) return { data: null, error: pathResult.error };

  // Step 5: Transition status → triggers Bedrock Lambda to apply redactions
  return updateCaseStatus(caseId, 'APPLYING_REDACTIONS');
}


// =============================================================================
// GUIDELINES  (admin only endpoints — backend enforces is_admin check)
// =============================================================================

/**
 * Create a new guideline record and get a presigned URL to upload the PDF.
 * → POST /guidelines/upload
 * Body: { description }
 * ← { success, message, guideline_id, upload_url, fields, version }
 */
export async function createGuideline(
  description: string
): Promise<ApiResponse<{ guideline_id: string; upload_url: string; fields: Record<string, string>; version: string }>> {
  const result = await request<{
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
      upload_url: result.data.upload_url,
      fields: result.data.fields,
      version: result.data.version,
    },
    error: null,
  };
}

/**
 * Trigger Bedrock Lambda to convert an uploaded guideline PDF to JSON rules.
 * Call this after successfully uploading the PDF to S3.
 * → POST /guidelines/{guideline_id}/process
 * ← { success, message, guideline_id, processing_status }
 */
export async function triggerGuidelineConversion(
  guidelineId: string
): Promise<ApiResponse<{ processing_status: BackendProcessingStatus }>> {
  const result = await request<{
    success: boolean;
    message: string;
    guideline_id: string;
    processing_status: BackendProcessingStatus;
  }>(`/guidelines/${encodeURIComponent(guidelineId)}/process`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  return {
    data: result.data ? { processing_status: result.data.processing_status } : null,
    error: result.error,
  };
}

/**
 * List all guidelines with metadata. Admin only.
 * → GET /guidelines/all
 * ← { success, count, active_guideline_id, guidelines: ApiGuideline[] }
 */
export async function getAllGuidelines(): Promise<ApiResponse<{
  active_guideline_id: string | null;
  guidelines: ApiGuideline[];
}>> {
  const result = await request<{
    success: boolean;
    count: number;
    active_guideline_id: string | null;
    guidelines: ApiGuideline[];
  }>('/guidelines/all');

  if (!result.data) return { data: null, error: result.error };

  return {
    data: {
      active_guideline_id: result.data.active_guideline_id,
      guidelines: result.data.guidelines,
    },
    error: null,
  };
}

/**
 * Get the currently active guideline including its full JSON content.
 * Available to all users (not admin-only).
 * → GET /guidelines/active
 * ← { success, guideline: ApiGuideline } where guideline includes guidelines_content
 */
export async function getActiveGuideline(): Promise<ApiResponse<ApiGuideline>> {
  const result = await request<{ success: boolean; guideline: ApiGuideline }>(
    `/guidelines/active?officer_id=${encodeURIComponent(_identity.officer_id)}`
  );
  return { data: result.data?.guideline ?? null, error: result.error };
}

/**
 * Update the JSON rules on a guideline after human review/editing.
 * The JSON must contain a top-level 'guidelines' array.
 * → PUT /guidelines/{guideline_id}
 * Body: { guidelines_json: GuidelinesJson }
 * ← { success, message, guideline_id, version }
 */
export async function updateGuidelineJson(
  guidelineId: string,
  guidelinesJson: GuidelinesJson
): Promise<ApiResponse<{ guideline_id: string; version: string }>> {
  const result = await request<{
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
 * Set a guideline as active (deactivates all others atomically).
 * Guideline must have processing_status === 'completed' to be activated.
 * → PUT /guidelines/{guideline_id}/activate
 * ← { success, message, guideline_id, version }
 */
export async function activateGuideline(
  guidelineId: string
): Promise<ApiResponse<{ guideline_id: string; version: string }>> {
  const result = await request<{
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
 * Delete a guideline. Cannot delete the currently active guideline.
 * → DELETE /guidelines/{guideline_id}
 * ← { success, message, guideline_id }
 */
export async function deleteGuideline(
  guidelineId: string
): Promise<ApiResponse<{ deleted: boolean }>> {
  const result = await request<{
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