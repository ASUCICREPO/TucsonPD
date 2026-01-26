import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, FileText, Upload, CheckCircle2, FileCheck, Shield } from 'lucide-react';
import { RedactionRulesInline } from './redaction-rules-inline';
import { RedactionCompleteInline } from './redaction-complete-inline';
import { ProcessingLoader } from './processing-loader';
import { DocumentViewer } from './document-viewer';

interface CaseDetailScreenProps {
  caseData: {
    id: string;
    caseId: string;
    requesterName: string;
    redactionStatus: 'Not Started' | 'In Progress' | 'Needs Review' | 'Completed';
    dateCreated: string;
  };
  onBack: () => void;
  onUpdateCase: (updatedCase: any) => void;
}

type RedactionStage = 'upload' | 'analyzing' | 'rules-review' | 'processing' | 'complete';

interface RedactionRule {
  category: string;
  matchCount: number;
  matches: {
    page: number;
    location: string;
    text: string;
  }[];
}

export function CaseDetailScreen({ caseData, onBack, onUpdateCase }: CaseDetailScreenProps) {
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

  // Mock redaction rules data
  const redactionRules: RedactionRule[] = [
    {
      category: 'Redact PII: Names',
      matchCount: 14,
      matches: [
        { page: 1, location: 'Line 4', text: 'Detective Sarah Martinez' },
        { page: 1, location: 'Paragraph 2', text: 'John Anderson' },
        { page: 2, location: 'Line 1', text: 'Michael Roberts' },
        { page: 2, location: 'Paragraph 1', text: 'Officer James Wilson' }
      ]
    },
    {
      category: 'Redact Phone Numbers',
      matchCount: 3,
      matches: [
        { page: 1, location: 'Contact Info', text: '(555) 123-4567' },
        { page: 2, location: 'Emergency Contact', text: '(555) 987-6543' },
        { page: 3, location: 'Witness Contact', text: '555-111-2222' }
      ]
    },
    {
      category: 'Redact Addresses',
      matchCount: 5,
      matches: [
        { page: 2, location: 'Paragraph 1', text: '123 W. Grant Road, Apt 4B' },
        { page: 2, location: 'Line 8', text: '456 Oak Street' },
        { page: 3, location: 'Residence Info', text: '789 Pine Avenue, Unit 12' }
      ]
    },
    {
      category: 'Redact Sensitive Identifiers',
      matchCount: 8,
      matches: [
        { page: 2, location: 'Personal Info', text: 'DOB: 07/22/1985' },
        { page: 2, location: 'ID Section', text: 'SSN: XXX-XX-1234' },
        { page: 3, location: 'Driver License', text: 'DL# A1234567' }
      ]
    }
  ];

  const redactionStats = {
    namesRedacted: 14,
    addressesRedacted: 5,
    phoneNumbersRedacted: 3,
    identifiersRedacted: 8,
    totalRedactions: 30
  };

  // Simulate analysis progress
  useEffect(() => {
    if (redactionStage === 'analyzing') {
      const interval = setInterval(() => {
        setAnalysisProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            setTimeout(() => setRedactionStage('rules-review'), 500);
            return 100;
          }
          return prev + 10;
        });
      }, 200);

      return () => clearInterval(interval);
    }
  }, [redactionStage]);

  // Simulate redaction processing
  useEffect(() => {
    if (redactionStage === 'processing') {
      setProcessingProgress(0);
      const interval = setInterval(() => {
        setProcessingProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            setTimeout(() => setRedactionStage('complete'), 500);
            return 100;
          }
          return prev + 10;
        });
      }, 300);

      return () => clearInterval(interval);
    }
  }, [redactionStage]);

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

  const handleSubmitRedaction = () => {
    if (selectedFile) {
      onUpdateCase({
        ...caseData,
        redactionStatus: 'In Progress'
      });
      setAnalysisProgress(0);
      setRedactionStage('analyzing');
    }
  };

  const handleApproveRules = () => {
    if (!isConfirmed) {
      alert('Please confirm that you have reviewed and approved the redaction rules.');
      return;
    }
    setRedactionStage('processing');
  };

  const handleRetryRedaction = () => {
    setRedactionStage('rules-review');
    setIsConfirmed(false);
  };

  const handleDownload = () => {
    alert('Downloading redacted document...');
  };

  const handleMarkComplete = () => {
    onUpdateCase({
      ...caseData,
      redactionStatus: 'Completed'
    });
    setIsMarkedComplete(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-slate-900 text-white py-6 px-8">
        <h1 className="text-white">TPD Records Processing System</h1>
      </header>

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

          {/* Case Header */}
          <div className="mb-6">
            <h2 className="text-slate-900 mb-2">Case {caseData.caseId}</h2>
            <p className="text-slate-600">Requester: {caseData.requesterName}</p>
          </div>

          {/* Main Card */}
          <div className="bg-white rounded-lg shadow-md border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="bg-slate-50 border-b border-slate-200 px-6 py-4">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-600" />
                <h3 className="text-slate-900">Document Redaction</h3>
              </div>
            </div>

            {/* Content */}
            <div className="p-8">
              {redactionStage === 'upload' ? (
                // Stage 1: Upload Document
                <div className="space-y-6">
                  <div>
                    <h3 className="text-slate-900 mb-2">Upload Unredacted Document</h3>
                    <p className="text-slate-600">
                      Upload the complete, unredacted document for automated redaction processing.
                    </p>
                  </div>

                  {/* Upload Area */}
                  <div
                    className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                      dragActive
                        ? 'border-blue-600 bg-blue-50'
                        : uploadStatus === 'uploaded'
                        ? 'border-emerald-500 bg-emerald-50'
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

                      {selectedFile && (
                        <div className="mt-4 p-4 bg-white rounded border border-slate-200 w-full max-w-md">
                          <div className="flex items-center gap-3">
                            <FileCheck className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-slate-900 truncate">{selectedFile.name}</p>
                              <p className="text-slate-500">
                                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

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
                    <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
                      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-200">
                        <FileText className="w-5 h-5 text-slate-600" />
                        <h3 className="text-slate-900">Document Preview</h3>
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
                    <div className="flex justify-end">
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
                  steps={[
                    { threshold: 40, label: 'Scanning document structure...' },
                    { threshold: 70, label: 'Identifying sensitive information...' },
                    { threshold: 100, label: 'Determining redaction rules...' }
                  ]}
                />
              ) : redactionStage === 'rules-review' ? (
                // Stage 3: Review Redaction Rules
                <RedactionRulesInline
                  fileName={selectedFile?.name || ''}
                  classificationLevel="Standard"
                  redactionRules={redactionRules}
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
                  steps={[
                    { threshold: 30, label: 'Analyzing document structure...' },
                    { threshold: 60, label: 'Applying redaction rules...' },
                    { threshold: 90, label: 'Generating redacted document...' }
                  ]}
                />
              ) : (
                // Stage 5: Redaction Complete
                <RedactionCompleteInline
                  fileName={selectedFile?.name || ''}
                  classificationLevel="Standard"
                  redactionStats={redactionStats}
                  isMarkedComplete={isMarkedComplete}
                  onDownload={handleDownload}
                  onRetry={handleRetryRedaction}
                  onComplete={handleMarkComplete}
                />
              )}
            </div>
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
