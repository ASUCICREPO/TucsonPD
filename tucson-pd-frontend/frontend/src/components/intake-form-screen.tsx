import { useState, useRef } from 'react';
import { ArrowLeft, FileText, Upload, CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { CaseStepper } from './case-stepper';
import { DocumentViewer } from './document-viewer';
import {
  createCase,
  getUploadPresignedUrl,
  uploadFileToS3,
  updateCaseS3Path,
  updateCaseStatus,
} from './apigatewaymanager';

// =============================================================================
// TYPES
// =============================================================================

interface IntakeFormScreenProps {
  onBack: () => void;
  /** Called once the intake form is fully uploaded. Passes the real case_id. */
  onSubmit: (caseId: string) => void;
}

type UploadStage =
  | 'idle'           // No file selected
  | 'file_selected'  // File chosen, not yet uploading
  | 'file_error'     // File failed local validation
  | 'creating_case'  // POST /cases in flight
  | 'getting_url'    // POST /presigned-url/upload in flight
  | 'uploading_s3'   // Direct S3 multipart POST in flight
  | 'updating_db'    // PUT /cases/{id}/s3-path + /status in flight
  | 'complete'       // All steps succeeded
  | 'api_error';     // Any API step failed

// =============================================================================
// CONSTANTS
// =============================================================================

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

const WORKING_STAGES: UploadStage[] = [
  'creating_case',
  'getting_url',
  'uploading_s3',
  'updating_db',
];

const STAGE_LABELS: Record<UploadStage, string> = {
  idle:           '',
  file_selected:  '',
  file_error:     '',
  creating_case:  'Creating case record…',
  getting_url:    'Preparing secure upload…',
  uploading_s3:   'Uploading to secure storage…',
  updating_db:    'Finalising case record…',
  complete:       'Upload complete!',
  api_error:      '',
};

const STEP_INDICATORS: { stage: UploadStage; label: string }[] = [
  { stage: 'creating_case', label: 'Creating case record' },
  { stage: 'getting_url',   label: 'Preparing secure upload' },
  { stage: 'uploading_s3',  label: 'Uploading to secure storage' },
  { stage: 'updating_db',   label: 'Finalising case record' },
];

// =============================================================================
// COMPONENT
// =============================================================================

export function IntakeFormScreen({ onBack, onSubmit }: IntakeFormScreenProps) {
  const [stage, setStage] = useState<UploadStage>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isWorking = WORKING_STAGES.includes(stage);

  // -------------------------------------------------------------------------
  // File selection
  // -------------------------------------------------------------------------

  function clearFile() {
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    setSelectedFile(null);
    setFilePreviewUrl(null);
    setStage('idle');
    setUploadProgress(0);
    setErrorMessage(null);
    // Reset so the same file can be re-selected after clearing
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function acceptFile(file: File) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      setStage('file_error');
      setErrorMessage('Invalid file type. Allowed formats: PDF, JPG, PNG, TIFF, DOC, DOCX.');
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setStage('file_error');
      setErrorMessage('File exceeds the 50 MB size limit.');
      return;
    }
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    setSelectedFile(file);
    setFilePreviewUrl(URL.createObjectURL(file));
    setStage('file_selected');
    setErrorMessage(null);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.[0]) acceptFile(e.target.files[0]);
  }

  function handleDrag(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) acceptFile(e.dataTransfer.files[0]);
  }

  // -------------------------------------------------------------------------
  // Upload sequence
  // -------------------------------------------------------------------------

  async function handleUpload() {
    if (!selectedFile) return;
    setErrorMessage(null);

    try {
      // ── Step 1: Create the case record ────────────────────────────────────
      setStage('creating_case');
      const createRes = await createCase();
      if (createRes.error || !createRes.data) {
        throw new Error(createRes.error ?? 'Failed to create case record.');
      }
      const caseId = createRes.data.case_id;

      // ── Step 2: Get presigned POST URL for the intake form ────────────────
      setStage('getting_url');
      const urlRes = await getUploadPresignedUrl(caseId, 'intake_form');
      if (urlRes.error || !urlRes.data) {
        throw new Error(urlRes.error ?? 'Failed to get upload URL.');
      }
      const { upload_url, fields, s3_path } = urlRes.data;

      // ── Step 3: Upload directly to S3 ─────────────────────────────────────
      setStage('uploading_s3');
      setUploadProgress(0);
      const s3Res = await uploadFileToS3(upload_url, fields, selectedFile, setUploadProgress);
      if (s3Res.error) {
        throw new Error(s3Res.error);
      }

      // ── Step 4: Record the S3 path on the case ────────────────────────────
      setStage('updating_db');
      const pathRes = await updateCaseS3Path(caseId, 'intake_form', s3_path);
      if (pathRes.error) {
        throw new Error(pathRes.error ?? 'Failed to record S3 path.');
      }

      // ── Step 5: Advance case status to INTAKE_UPLOADED ────────────────────
      const statusRes = await updateCaseStatus(caseId, 'INTAKE_UPLOADED');
      if (statusRes.error) {
        throw new Error(statusRes.error ?? 'Failed to update case status.');
      }

      // ── Done ──────────────────────────────────────────────────────────────
      setStage('complete');
      // Brief pause so the officer sees the success state before advancing
      setTimeout(() => onSubmit(caseId), 1200);

    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setStage('api_error');
    }
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  function getStepStatus(stepStage: UploadStage): 'done' | 'active' | 'pending' {
    const currentIdx = WORKING_STAGES.indexOf(stage);
    const stepIdx = WORKING_STAGES.indexOf(stepStage);
    if (stepIdx < currentIdx) return 'done';
    if (stepIdx === currentIdx) return 'active';
    return 'pending';
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <CaseStepper currentStep={1} />

      <main className="flex-1 px-8 py-8">
        <div className="max-w-7xl mx-auto">

          {/* Back button — disabled while an upload is in flight */}
          <button
            onClick={onBack}
            disabled={isWorking}
            className="mb-6 flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Dashboard
          </button>

          {/* Header */}
          <div className="mb-6">
            <h2 className="text-slate-900 font-bold mb-2">Upload Intake Form</h2>
            <p className="text-slate-600">
              Upload a completed intake form to begin the redaction process. This document
              will be stored for reference and is not used by the AI redaction system.
            </p>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">

            {/* ── Drop zone (idle + file error) ── */}
            {(stage === 'idle' || stage === 'file_error') && (
              <div
                className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                  dragActive
                    ? 'border-blue-600 bg-blue-50'
                    : stage === 'file_error'
                    ? 'border-red-400 bg-red-50'
                    : 'border-slate-300 bg-slate-50'
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <div className="flex flex-col items-center gap-4">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                    stage === 'file_error' ? 'bg-red-100' : 'bg-slate-100'
                  }`}>
                    {stage === 'file_error'
                      ? <XCircle className="w-8 h-8 text-red-600" />
                      : <Upload className="w-8 h-8 text-slate-600" />
                    }
                  </div>

                  {stage === 'file_error' ? (
                    <>
                      <p className="text-red-800">{errorMessage}</p>
                      <button
                        type="button"
                        onClick={() => { setStage('idle'); setErrorMessage(null); }}
                        className="px-6 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 transition-colors"
                      >
                        Try Again
                      </button>
                    </>
                  ) : (
                    <>
                      <div>
                        <p className="text-slate-900 mb-2">Drag and drop your intake form here</p>
                        <p className="text-slate-500">or</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-6 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 transition-colors"
                      >
                        Browse Files
                      </button>
                    </>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.tiff,.doc,.docx"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <p className="text-slate-500 text-sm">
                    Allowed: PDF, JPG, PNG, TIFF, DOC, DOCX — max 50 MB
                  </p>
                </div>
              </div>
            )}

            {/* ── File selected — preview ── */}
            {stage === 'file_selected' && selectedFile && filePreviewUrl && (
              <div>
                <div className="flex items-center justify-between mb-4 border border-slate-200 p-4 rounded-lg">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <FileText className="w-5 h-5 text-slate-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-900 truncate">{selectedFile.name}</p>
                      <p className="text-slate-500 text-sm">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearFile}
                    className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors flex-shrink-0 ml-4"
                  >
                    Replace File
                  </button>
                </div>
                <DocumentViewer
                  fileUrl={filePreviewUrl}
                  fileName={selectedFile.name}
                  fileType={selectedFile.type}
                  fileSize={selectedFile.size}
                />
              </div>
            )}

            {/* ── In-progress ── */}
            {isWorking && selectedFile && (
              <div className="space-y-6">
                {/* File info bar */}
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-center gap-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-900 truncate">{selectedFile.name}</p>
                    <p className="text-slate-500 text-sm">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>

                {/* Progress panel */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-8">
                  <div className="flex flex-col items-center text-center space-y-6">
                    <Loader2 className="w-14 h-14 text-blue-600 animate-spin" />
                    <p className="text-slate-900 font-medium">{STAGE_LABELS[stage]}</p>

                    {/* S3 upload progress bar */}
                    {stage === 'uploading_s3' && (
                      <div className="w-full max-w-md">
                        <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                          <div
                            className="bg-blue-600 h-full transition-all duration-200 ease-out"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <p className="text-slate-500 text-sm mt-2">{uploadProgress}% complete</p>
                      </div>
                    )}

                    {/* Step indicators */}
                    <div className="space-y-2 w-full max-w-sm text-left">
                      {STEP_INDICATORS.map(({ stage: stepStage, label }) => {
                        const status = getStepStatus(stepStage);
                        return (
                          <div
                            key={stepStage}
                            className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                              status === 'active' ? 'bg-blue-100' : 'bg-transparent'
                            }`}
                          >
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              status === 'done'   ? 'bg-green-500' :
                              status === 'active' ? 'bg-blue-600 animate-pulse' :
                                                   'bg-slate-300'
                            }`} />
                            <span className={`text-sm ${
                              status === 'done'   ? 'text-green-700' :
                              status === 'active' ? 'text-blue-900 font-medium' :
                                                   'text-slate-500'
                            }`}>
                              {label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Success ── */}
            {stage === 'complete' && selectedFile && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-10">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                    <CheckCircle2 className="w-10 h-10 text-green-600" />
                  </div>
                  <h3 className="text-slate-900">Intake Form Uploaded</h3>
                  <p className="text-slate-600">Proceeding to document upload…</p>
                  <div className="bg-white border border-green-200 rounded-lg p-4 w-full max-w-md">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <FileText className="w-5 h-5 text-green-600" />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-slate-900 truncate">{selectedFile.name}</p>
                        <p className="text-slate-500 text-sm">
                          {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── API error ── */}
            {stage === 'api_error' && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-8">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-red-600" />
                  </div>
                  <h3 className="text-slate-900">Upload Failed</h3>
                  <p className="text-red-700 text-sm max-w-md">{errorMessage}</p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={clearFile}
                      className="px-5 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      Start Over
                    </button>
                    <button
                      type="button"
                      onClick={handleUpload}
                      className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action buttons — only shown before upload starts */}
          {(stage === 'idle' || stage === 'file_selected' || stage === 'file_error') && (
            <div className="flex justify-end gap-4">
              <button
                type="button"
                onClick={onBack}
                className="px-6 py-3 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={stage !== 'file_selected'}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                <Upload className="w-5 h-5" />
                Upload Intake Form
              </button>
            </div>
          )}

        </div>
      </main>

      <footer className="bg-slate-900 text-slate-400 py-4 px-8 text-center mt-8">
        <p>TPD Records Processing System v1.0 | Secure Document Processing</p>
      </footer>
    </div>
  );
}