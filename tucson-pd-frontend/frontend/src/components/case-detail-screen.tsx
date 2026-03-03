import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, FileText, Upload, CheckCircle2, FileCheck, Shield } from 'lucide-react';
import { RedactionRulesInline } from './redaction-rules-inline';
import { RedactionCompleteInline } from './redaction-complete-inline';
import { ProcessingLoader } from './processing-loader';
import { DocumentViewer } from './document-viewer';
import { IntakeFormData } from './intake-form-screen';
import { CaseStepper } from './case-stepper';
import { toast } from 'sonner';
import {
  getUploadPresignedUrl,
  uploadFileToS3,
  updateCaseS3Path,
  updateCaseStatus,
  getCaseById,
  getDownloadPresignedUrl,
  submitEditedRedactions,
  type RedactionProposalsJson,
} from './apigatewaymanager';

interface CaseDetailScreenProps {
  caseData: {
    id: string;
    caseId: string;
    requesterName: string;
    redactionStatus: 'Not Started' | 'In Progress' | 'Needs Review' | 'Completed';
    dateCreated: string;
    updatedAt?: number | null;  // Unix seconds — when the current status was set
    // Redaction state
    redactionStage?: RedactionStage;
    fileName?: string;
    fileData?: string; // Base64 encoded file data
    fileType?: string;
    fileSize?: number;
    caseNumber?: string;
    redactionCategory?: string;
    isConfirmed?: boolean;
    isMarkedComplete?: boolean;
    // Intake form data
    intakeFormData?: IntakeFormData | null;
  };
  onBack: () => void;
  onBackToIntakeForm?: () => void;
  onUpdateCase: (updatedCase: any) => void;
  onAddCase: (newCase: any) => void;
  isNewCase: boolean;
}

type RedactionStage = 'upload' | 'analyzing' | 'rules-review' | 'processing' | 'complete';

export function CaseDetailScreen({ caseData, onBack, onBackToIntakeForm, onUpdateCase, onAddCase, isNewCase }: CaseDetailScreenProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'ready' | 'uploaded' | 'error'>('ready');
  const [redactionStage, setRedactionStage] = useState<RedactionStage>('upload');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isMarkedComplete, setIsMarkedComplete] = useState(false);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reviewingStatusSetRef = useRef(false);

  function clearFile() {
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    setSelectedFile(null);
    setFilePreviewUrl(null);
    setUploadStatus('ready');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Form fields
  const [caseNumber, setCaseNumber] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [redactionCategory, setRedactionCategory] = useState('Criminal Cases');

  // Initialize state from caseData when loading an existing case
  useEffect(() => {
    if (!isNewCase && caseData) {
      // Restore form fields
      if (caseData.caseNumber) setCaseNumber(caseData.caseNumber);
      if (caseData.requesterName) setRequesterName(caseData.requesterName);
      if (caseData.redactionCategory) setRedactionCategory(caseData.redactionCategory);
      
      // Restore redaction stage and state
      if (caseData.redactionStage) setRedactionStage(caseData.redactionStage);
      if (caseData.isConfirmed) setIsConfirmed(caseData.isConfirmed);
      if (caseData.isMarkedComplete) setIsMarkedComplete(caseData.isMarkedComplete);
      
      // Restore file if exists
      if (caseData.fileName && caseData.fileData && caseData.fileType) {
        // Convert base64 back to File
        fetch(caseData.fileData)
          .then(res => res.blob())
          .then(blob => {
            const file = new File([blob], caseData.fileName!, { type: caseData.fileType });
            setSelectedFile(file);
            setUploadStatus('uploaded');
          });
      }
    } else if (isNewCase && caseData.intakeFormData) {
      // Pre-fill form from intake form data
      setCaseNumber(caseData.intakeFormData.caseNumber);
      setRequesterName(caseData.intakeFormData.requesterName);
      setRedactionCategory(caseData.intakeFormData.redactionCategory);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentionally run once on mount only

  // redactionStats derived from real case metadata after completion
  const redactionStats = {
    totalRedactions: (caseData as any).metadata?.total_redactions_applied ?? 0,
  };

  // If we land directly into rules-review (e.g. reopening a REVIEW_READY case),
  // mark it REVIEWING so the backend knows it is being actively worked on.
  // The ref guard ensures this only fires once per mount, not on every stage change
  // back to rules-review, which would overwrite the backend status and cause looping.
  useEffect(() => {
    if (redactionStage === 'rules-review' && !isNewCase && !reviewingStatusSetRef.current) {
      reviewingStatusSetRef.current = true;
      updateCaseStatus(caseData.id, 'REVIEWING').catch(console.error);
    }
  }, [redactionStage]);

  // Poll backend status while in the analyzing stage
  useEffect(() => {
    if (redactionStage !== 'analyzing') return;

    const interval = setInterval(async () => {
      const { data } = await getCaseById(caseData.id);
      if (!data) return;

      if (data.status === 'REVIEW_READY' || data.status === 'REVIEWING') {
        clearInterval(interval);
        // Mark REVIEWING so the backend knows an officer has opened the proposals
        if (data.status === 'REVIEW_READY') {
          await updateCaseStatus(caseData.id, 'REVIEWING');
        }
        setRedactionStage('rules-review');
      } else if (data.status === 'FAILED') {
        clearInterval(interval);
        toast.error('AI processing failed', { description: 'Please try uploading the document again.' });
        setRedactionStage('upload');
        setUploadStatus('ready');
      }
      // Keep a slow visual progress tick so the UI doesn't look frozen
      setAnalysisProgress(prev => Math.min(prev + 5, 90));
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [redactionStage, caseData.id]);

  // Poll backend while applying redactions — mirrors the analyzing poller
  useEffect(() => {
    if (redactionStage !== 'processing') return;

    setProcessingProgress(0);
    const interval = setInterval(async () => {
      const { data } = await getCaseById(caseData.id);
      if (!data) return;

      if (data.status === 'COMPLETED' || data.status === 'CLOSED') {
        clearInterval(interval);
        setProcessingProgress(100);
        setTimeout(() => {
          setRedactionStage('complete');
          onUpdateCase({ ...caseData, redactionStage: 'complete' as const });
        }, 500);
      } else if (data.status === 'FAILED') {
        clearInterval(interval);
        toast.error('Redaction failed', { description: 'Please review the proposals and try again.' });
        setRedactionStage('rules-review');
        setIsConfirmed(false);
      }
      // Slow visual tick so the loader doesn't look frozen
      setProcessingProgress(prev => Math.min(prev + 5, 90));
    }, 5000);

    return () => clearInterval(interval);
  }, [redactionStage, caseData.id]);

  // Create preview URL when file is selected
  useEffect(() => {
    if (selectedFile) {
      // Clean up previous URL if it exists
      if (filePreviewUrl) {
        URL.revokeObjectURL(filePreviewUrl);
      }
      
      // Create new object URL
      const url = URL.createObjectURL(selectedFile);
      setFilePreviewUrl(url);
    }

    // Cleanup function
    return () => {
      if (filePreviewUrl) {
        URL.revokeObjectURL(filePreviewUrl);
      }
    };
  }, [selectedFile]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const validateFile = (file: File): boolean => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'];
    const maxSize = 50 * 1024 * 1024; // 50MB

    if (!allowedTypes.includes(file.type)) {
      setUploadStatus('error');
      return false;
    }

    if (file.size > maxSize) {
      setUploadStatus('error');
      return false;
    }

    return true;
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (validateFile(file)) {
        setSelectedFile(file);
        setUploadStatus('uploaded');
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (validateFile(file)) {
        setSelectedFile(file);
        setUploadStatus('uploaded');
      }
    }
  };

  const handleSubmitRedaction = async () => {
    if (!selectedFile) return;

    const caseId = caseData.id;

    try {
      // Step 1: Get presigned upload URL
      toast.loading('Preparing upload...', { id: 'upload' });
      const { data: presignedData, error: presignedError } = await getUploadPresignedUrl(caseId, 'unredacted_doc');
      if (presignedError || !presignedData) {
        toast.error('Failed to prepare upload', { id: 'upload', description: presignedError ?? 'Unknown error' });
        return;
      }

      // Step 2: Upload file directly to S3
      toast.loading('Uploading document...', { id: 'upload' });
      const { error: uploadError } = await uploadFileToS3(
        presignedData.upload_url,
        presignedData.fields,
        selectedFile,
        (percent) => {
          if (percent < 100) toast.loading(`Uploading... ${percent}%`, { id: 'upload' });
        }
      );
      if (uploadError) {
        toast.error('Upload failed', { id: 'upload', description: uploadError });
        return;
      }

      // Step 3: Record S3 path on the case
      const { error: pathError } = await updateCaseS3Path(caseId, 'unredacted_doc', presignedData.s3_path);
      if (pathError) {
        toast.error('Failed to record upload', { id: 'upload', description: pathError });
        return;
      }

      // Step 4: Update status to UNREDACTED_UPLOADED — this triggers the Bedrock Lambda
      const { error: statusError } = await updateCaseStatus(caseId, 'UNREDACTED_UPLOADED');
      if (statusError) {
        toast.error('Failed to start processing', { id: 'upload', description: statusError });
        return;
      }

      toast.success('Document uploaded — AI analysis started', { id: 'upload' });

      // Transition UI to the analyzing/polling stage
      setAnalysisProgress(0);
      setRedactionStage('analyzing');

    } catch (err) {
      toast.error('Unexpected error during upload', { id: 'upload' });
      console.error(err);
    }
  };

  const handleApproveRules = async (editedJson: RedactionProposalsJson) => {
    try {
      toast.loading('Submitting redactions...', { id: 'approve' });
      const { error } = await submitEditedRedactions(caseData.id, editedJson, (pct) => {
        if (pct < 100) toast.loading(`Submitting... ${pct}%`, { id: 'approve' });
      });
      if (error) {
        toast.error('Failed to submit redactions', { id: 'approve', description: error });
        return;
      }
      toast.success('Redactions submitted — applying now', { id: 'approve' });
      setIsConfirmed(false);
      setProcessingProgress(0);
      onUpdateCase({ ...caseData, redactionStage: 'processing' as const, isConfirmed: false });
      setRedactionStage('processing');
    } catch (err) {
      toast.error('Unexpected error submitting redactions', { id: 'approve' });
      console.error(err);
    }
  };

  const handleRetryRedaction = () => {
    setRedactionStage('rules-review');
    setIsConfirmed(false);
  };

  const handleBackToUpload = () => {
    setRedactionStage('upload');
    setIsConfirmed(false);
  };

  const handleDownload = async () => {
    toast.loading('Preparing download...', { id: 'download' });
    const { data: url, error } = await getDownloadPresignedUrl(caseData.id, 'redacted_doc');
    if (error || !url) {
      toast.error('Download failed', { id: 'download', description: error ?? 'Unknown error' });
      return;
    }
    toast.dismiss('download');
    // Open in new tab — browser will trigger the file download
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleMarkComplete = async () => {
    const { error } = await updateCaseStatus(caseData.id, 'COMPLETED');
    if (error) {
      toast.error('Failed to mark case complete', { description: error });
      return;
    }
    setIsMarkedComplete(true);
    onUpdateCase({ ...caseData, redactionStatus: 'Completed' });
  };

  const handleGoToDashboard = () => {
    // Add or update the case when going back to dashboard
    if (isNewCase) {
      const permanentCase = {
        ...caseData,
        id: caseData.id.replace('temp-', ''),
        redactionStatus: 'Completed' as const
      };
      onAddCase(permanentCase);
    } else {
      onUpdateCase({
        ...caseData,
        redactionStatus: 'Completed'
      });
    }
    onBack();
  };

  // Map redaction stage to stepper step
  const getCurrentStepperStep = (): 1 | 2 | 3 | 4 => {
    switch (redactionStage) {
      case 'upload':
      case 'analyzing':
        return 2; // Unredacted Document Upload
      case 'rules-review':
      case 'processing':
        return 3; // Redaction Review
      case 'complete':
        return 4; // Final Document
      default:
        return 2;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Stepper - Only show for new cases */}
      {isNewCase && <CaseStepper currentStep={getCurrentStepperStep()} />}
      
      {/* Main Content */}
      <main className="flex-1 px-8 py-8">
        <div className="max-w-7xl mx-auto">
          {/* Back Button */}
          <button
            onClick={onBack}
            className="mb-6 flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Dashboard
          </button>

          {/* Main Content */}
          <div>
            {redactionStage === 'upload' ? (
              // Stage 1: Upload Document
              <div className="space-y-6">
                {/* Upload Area */}
                {uploadStatus !== 'uploaded' && (
                  <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
                    <div className="mb-6">
                      <h2 className="text-slate-900 font-bold mb-2">Upload Unredacted Document</h2>
                      <p className="text-slate-600">
                        Upload the complete, unredacted document for automated redaction processing.
                      </p>
                    </div>
                    <div
                      className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                        dragActive
                          ? 'border-blue-600 bg-blue-50'
                          : uploadStatus === 'error'
                          ? 'border-red-500 bg-red-50'
                          : 'border-slate-300 bg-slate-50'
                      }`}
                      onDragEnter={handleDrag}
                      onDragLeave={handleDrag}
                      onDragOver={handleDrag}
                      onDrop={handleDrop}
                    >
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
                          <Upload className="w-8 h-8 text-slate-600" />
                        </div>

                        <div>
                          <p className="text-slate-900 mb-2">
                            Drag and drop your unredacted document here
                          </p>
                          <p className="text-slate-500">or</p>
                        </div>

                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="px-6 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 transition-colors"
                        >
                          Browse Files
                        </button>

                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.tiff"
                          onChange={handleFileSelect}
                          className="hidden"
                        />

                        <p className="text-slate-500">
                          Allowed formats: .pdf, .jpg, .png, .tiff (Max 50MB)
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Error Message */}
                {uploadStatus === 'error' && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-800">
                      Invalid file format or size. Please upload a valid PDF, JPG, PNG, or TIFF file under 50MB.
                    </p>
                  </div>
                )}

                {/* Document Preview - Show when file is uploaded */}
                {uploadStatus === 'uploaded' && selectedFile && filePreviewUrl && (
                  <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6 mb-6">
                    <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-200">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <FileText className="w-5 h-5 text-slate-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <h3 className="text-slate-900 truncate">{selectedFile.name}</h3>
                          <p className="text-slate-500">
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

                {/* Submit Button */}
                {uploadStatus === 'uploaded' && (
                  <div className={`flex items-center ${isNewCase && onBackToIntakeForm ? 'justify-between' : 'justify-end'}`}>
                    {isNewCase && onBackToIntakeForm && (
                      <button
                        onClick={onBackToIntakeForm}
                        className="px-6 py-3 bg-slate-200 text-slate-900 rounded-lg hover:bg-slate-300 transition-colors flex items-center gap-2"
                      >
                        <ArrowLeft className="w-5 h-5" />
                        Back to Form Upload
                      </button>
                    )}
                    <button
                      onClick={handleSubmitRedaction}
                      className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Submit for Redaction
                    </button>
                  </div>
                )}
              </div>
            ) : redactionStage === 'analyzing' ? (
              // Stage 2: Analyzing Document (Loader)
              <ProcessingLoader
                title="Analyzing Document..."
                description="Processing document to determine redaction rules."
                progress={analysisProgress}
                fileName={selectedFile?.name || ''}
                caseId=""
                startedAt={caseData.updatedAt ?? undefined}
                steps={[
                  { threshold: 40, label: 'Scanning document structure...' },
                  { threshold: 70, label: 'Identifying sensitive information...' },
                  { threshold: 100, label: 'Determining redaction rules...' }
                ]}
              />
            ) : redactionStage === 'rules-review' ? (
              // Stage 3: Review Redaction Rules
              <RedactionRulesInline
                caseId={caseData.id}
                isConfirmed={isConfirmed}
                onConfirmChange={setIsConfirmed}
                onApprove={handleApproveRules}
              />
            ) : redactionStage === 'processing' ? (
              // Stage 4: Processing Redaction (Loader)
              <ProcessingLoader
                title="Applying Redaction..."
                description="This may take several seconds depending on document length."
                progress={processingProgress}
                fileName={selectedFile?.name || ''}
                caseId={caseData.caseId}
                startedAt={caseData.updatedAt ?? undefined}
                steps={[
                  { threshold: 30, label: 'Analyzing document structure...' },
                  { threshold: 60, label: 'Applying redaction rules...' },
                  { threshold: 90, label: 'Generating redacted document...' }
                ]}
              />
            ) : (
              // Stage 5: Redaction Complete
              <RedactionCompleteInline
                caseId={caseData.id}
                fileName={selectedFile?.name || ''}
                classificationLevel="Standard"
                redactionStats={redactionStats}
                isMarkedComplete={isMarkedComplete}
                onDownload={handleDownload}
                onComplete={handleMarkComplete}
                onGoToDashboard={handleGoToDashboard}
              />
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-4 px-8 text-center mt-8">
        <p>TPD Records Processing System v1.0 | Secure Document Processing</p>
      </footer>
    </div>
  );
}