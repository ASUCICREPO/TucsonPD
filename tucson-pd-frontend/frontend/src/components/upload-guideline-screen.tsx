import { useState, useRef, useEffect } from 'react';
import { Upload, FileText, ArrowLeft, AlertCircle, Loader2, CheckCircle } from 'lucide-react';
import { PDFPageViewer } from './pdf-page-viewer';
import {
  createGuideline,
  triggerGuidelineProcessing,
  pollGuidelineUntilReady,
  uploadFileToS3,
  fetchGuidelineRules,
  type FrontendRule,
  type GuidelineProcessingStatus,
} from './adminapimanager';

// =============================================================================
// TYPES
// =============================================================================

interface UploadGuidelineScreenProps {
  onBack: () => void;
  /** Called when processing completes — hands the extracted rules and the
   *  guideline_id to the parent so ReviewExtractedRules can be shown. */
  onProcessingComplete: (guidelineId: string, rules: FrontendRule[], fileName: string) => void;
}

// Processing has four distinct UI phases the user sees
type Phase =
  | 'idle'          // File not yet chosen
  | 'ready'         // File chosen, description entered — ready to submit
  | 'uploading'     // S3 upload in progress (shows % progress)
  | 'processing'    // Bedrock Lambda running — polling for completion
  | 'error';        // Something went wrong — show message + retry

// =============================================================================
// UPLOAD PROGRESS BAR
// =============================================================================

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
      <div
        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

// =============================================================================
// PROCESSING STATUS LABEL
// Shown while Bedrock is converting the PDF to JSON rules
// =============================================================================

const PROCESSING_LABELS: Record<GuidelineProcessingStatus, string> = {
  pending:    'Queued for processing…',
  processing: 'Extracting rules from document…',
  completed:  'Rules extracted successfully',
  failed:     'Processing failed',
};

// =============================================================================
// COMPONENT
// =============================================================================

export function UploadGuidelineScreen({ onBack, onProcessingComplete }: UploadGuidelineScreenProps) {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState<GuidelineProcessingStatus>('pending');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Abort controller so polling stops if the user navigates away
  const abortControllerRef = useRef<AbortController | null>(null);

  // Clean up polling and blob URL on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    };
  }, []);

  // Derive whether the form is ready to submit
  const isReady = uploadedFile !== null && description.trim().length > 0;

  // ---------------------------------------------------------------------------
  // FILE SELECTION
  // ---------------------------------------------------------------------------

  const acceptFile = (file: File) => {
    const allowed = [
      'application/pdf',
    ];
    if (!allowed.includes(file.type)) {
      setErrorMessage('Please upload a PDF file.');
      return;
    }
    setErrorMessage(null);
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    setUploadedFile(file);
    setFilePreviewUrl(file.type === 'application/pdf' ? URL.createObjectURL(file) : null);
    setPhase('ready');
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) acceptFile(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) acceptFile(file);
  };

  const handleReplaceFile = () => {
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    setUploadedFile(null);
    setFilePreviewUrl(null);
    setPhase('idle');
    setErrorMessage(null);
  };

  // ---------------------------------------------------------------------------
  // SUBMIT — full 3-step upload sequence
  // ---------------------------------------------------------------------------

  const handleSubmit = async () => {
    if (!uploadedFile || !description.trim()) return;

    setErrorMessage(null);

    // ── Step 1: Create guideline record → receive presigned URL ──────────────
    setPhase('uploading');
    setUploadProgress(0);

    const createResult = await createGuideline(description.trim());

    if (createResult.error || !createResult.data) {
      setPhase('error');
      setErrorMessage(createResult.error ?? 'Failed to create guideline record.');
      return;
    }

    const { guideline_id, upload_url, fields } = createResult.data;

    // ── Step 2: Upload PDF directly to S3 ────────────────────────────────────
    const uploadResult = await uploadFileToS3(
      upload_url,
      fields,
      uploadedFile,
      (percent) => setUploadProgress(percent)
    );

    if (uploadResult.error) {
      setPhase('error');
      setErrorMessage(`Upload failed: ${uploadResult.error}`);
      return;
    }

    // ── Step 3: Trigger Bedrock processing ───────────────────────────────────
    setPhase('processing');
    setProcessingStatus('pending');

    const triggerResult = await triggerGuidelineProcessing(guideline_id);

    if (triggerResult.error) {
      setPhase('error');
      setErrorMessage(`Failed to start processing: ${triggerResult.error}`);
      return;
    }

    // ── Step 4: Poll until completed or failed ───────────────────────────────
    abortControllerRef.current = new AbortController();

    const pollResult = await pollGuidelineUntilReady(
      guideline_id,
      (status) => setProcessingStatus(status),
      abortControllerRef.current.signal
    );

    if (pollResult.error) {
      setPhase('error');
      setErrorMessage(pollResult.error);
      return;
    }

    // ── Step 5: Fetch extracted rules and hand off to parent ─────────────────
    // pollGuidelineUntilReady resolves via getAllGuidelines which does NOT
    // attach guidelines_content — fetch the rules directly via the new endpoint.
    const { data: frontendRules, error: rulesError } = await fetchGuidelineRules(guideline_id);

    if (rulesError || !frontendRules?.length) {
      setPhase('error');
      setErrorMessage(rulesError ?? 'Processing completed but no rules were extracted. Please try again or check the document format.');
      return;
    }

    onProcessingComplete(guideline_id, frontendRules, uploadedFile.name);
  };

  // ---------------------------------------------------------------------------
  // RENDER — UPLOADING PHASE
  // ---------------------------------------------------------------------------

  if (phase === 'uploading') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <main className="flex-1 flex items-center justify-center px-8 py-8">
          <div className="bg-white rounded-lg shadow-md border border-slate-200 p-10 max-w-lg w-full text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
            <h2 className="text-slate-900 mb-2">Uploading Document</h2>
            <p className="text-slate-500 mb-6 truncate">{uploadedFile?.name}</p>
            <ProgressBar percent={uploadProgress} />
            <p className="text-slate-500 mt-3">{uploadProgress}%</p>
          </div>
        </main>
        <footer className="bg-slate-900 text-slate-400 py-4 px-8 text-center">
          <p>TPD Records Processing System v1.0 | Secure Document Processing</p>
        </footer>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // RENDER — PROCESSING PHASE
  // ---------------------------------------------------------------------------

  if (phase === 'processing') {
    const handleBackDuringProcessing = () => {
      // Cancel the poll so it doesn't keep running in the background
      abortControllerRef.current?.abort();
      onBack();
    };

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <main className="flex-1 flex items-center justify-center px-8 py-8">
          <div className="bg-white rounded-lg shadow-md border border-slate-200 p-10 max-w-lg w-full text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
              {processingStatus === 'completed'
                ? <CheckCircle className="w-8 h-8 text-emerald-600" />
                : <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              }
            </div>
            <h2 className="text-slate-900 mb-2">Analyzing Document</h2>
            <p className="text-slate-500 mb-2 truncate">{uploadedFile?.name}</p>
            <p className="text-slate-600 mt-4">
              {PROCESSING_LABELS[processingStatus]}
            </p>
            <p className="text-slate-400 text-sm mt-4">
              This may take a minute depending on document length.
            </p>
            <p className="text-slate-400 text-sm mt-1">
              You can return to the dashboard — processing will continue in the background.
            </p>
            <button
              onClick={handleBackDuringProcessing}
              className="mt-6 flex items-center gap-2 text-blue-600 hover:text-blue-700 transition-colors mx-auto"
            >
              <ArrowLeft className="w-4 h-4" />
              Return to Dashboard
            </button>
          </div>
        </main>
        <footer className="bg-slate-900 text-slate-400 py-4 px-8 text-center">
          <p>TPD Records Processing System v1.0 | Secure Document Processing</p>
        </footer>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // RENDER — MAIN (idle / ready / error)
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <main className="flex-1 px-8 py-8">
        <div className="max-w-4xl mx-auto">

          {/* Back */}
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Return to Dashboard
          </button>

          <div className="bg-white rounded-lg shadow-md border border-slate-200 p-8">
            <div className="mb-6">
              <h2 className="text-slate-900 mb-2">Upload New Guideline Document</h2>
              <p className="text-slate-600">
                Provide a name and upload a PDF guidelines document.
                The system will extract redaction rules automatically.
              </p>
            </div>

            {/* Error Banner */}
            {errorMessage && (
              <div className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-red-700">{errorMessage}</p>
              </div>
            )}

            {/* ── Guideline Name ── */}
            <div className="mb-6">
              <label className="block text-slate-900 font-medium mb-2" htmlFor="guideline-description">
                Guideline Name <span className="text-red-500">*</span>
              </label>
              <input
                id="guideline-description"
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="e.g. Standard Redaction Guidelines 2026"
                className="w-full px-4 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-colors"
              />
            </div>

            {/* ── File Upload ── */}
            {!uploadedFile ? (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                  isDragging ? 'border-blue-600 bg-blue-50' : 'border-slate-300 bg-slate-50'
                }`}
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
                    <Upload className="w-8 h-8 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-slate-900 mb-2">Drag and drop your file here</p>
                    <p className="text-slate-500">or</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => document.getElementById('guideline-file-upload')?.click()}
                    className="px-6 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 transition-colors"
                  >
                    Browse Files
                  </button>
                  <input
                    id="guideline-file-upload"
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <p className="text-slate-500">Accepted format: PDF</p>
                </div>
              </div>
            ) : (
              <>
                {/* File Preview */}
                <div className="mb-8">
                  <h3 className="text-slate-900 mb-4">Selected File</h3>
                  <div className="border-2 border-slate-200 rounded-lg p-6 bg-slate-50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <FileText className="w-6 h-6 text-blue-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-slate-900 truncate">{uploadedFile.name}</p>
                          <p className="text-slate-500">
                            {(uploadedFile.size / (1024 * 1024)).toFixed(2)} MB
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={handleReplaceFile}
                        className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors flex-shrink-0 ml-4"
                      >
                        Replace File
                      </button>
                    </div>
                  </div>

                  {/* PDF preview — only available for PDF uploads, not DOCX */}
                  {filePreviewUrl && (
                    <div className="mt-4 max-h-[600px] overflow-y-auto border border-slate-200 rounded-lg p-4 bg-white">
                      <PDFPageViewer
                        fileUrl={filePreviewUrl}
                        fileName={uploadedFile.name}
                      />
                    </div>
                  )}
                </div>

                {/* Submit */}
                <div className="flex items-center justify-end gap-4">
                  {!isReady && (
                    <p className="text-slate-400 text-sm">
                      {!description.trim() ? 'Enter a guideline name to continue.' : ''}
                    </p>
                  )}
                  <button
                    onClick={handleSubmit}
                    disabled={!isReady}
                    className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
                  >
                    Scan Document
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </main>

      <footer className="bg-slate-900 text-slate-400 py-4 px-8 text-center mt-8">
        <p>TPD Records Processing System v1.0 | Secure Document Processing</p>
      </footer>
    </div>
  );
}