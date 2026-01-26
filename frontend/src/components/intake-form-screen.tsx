import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, FileText, User, Calendar, Phone, Mail, Building2, Upload, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { CaseStepper } from './case-stepper';
import { DocumentViewer } from './document-viewer';

interface IntakeFormScreenProps {
  onBack: () => void;
  onSubmit: (formData: IntakeFormData) => void;
  initialData?: Partial<IntakeFormData>;
}

export interface IntakeFormData {
  // Requester Information
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string;
  requesterOrganization: string;
  
  // Request Details
  caseNumber: string;
  incidentDate: string;
  requestDescription: string;
  redactionCategory: string;
  
  // Additional Information
  urgencyLevel: string;
  deliveryMethod: string;
  additionalNotes: string;
  
  // File upload
  intakeFile?: File;
  fileName?: string;
  fileData?: string;
  fileType?: string;
}

export function IntakeFormScreen({ onBack, onSubmit, initialData }: IntakeFormScreenProps) {
  const [formData, setFormData] = useState<IntakeFormData>({
    requesterName: initialData?.requesterName || '',
    requesterEmail: initialData?.requesterEmail || '',
    requesterPhone: initialData?.requesterPhone || '',
    requesterOrganization: initialData?.requesterOrganization || '',
    caseNumber: initialData?.caseNumber || '',
    incidentDate: initialData?.incidentDate || '',
    requestDescription: initialData?.requestDescription || '',
    redactionCategory: initialData?.redactionCategory || 'Criminal Cases',
    urgencyLevel: initialData?.urgencyLevel || 'Standard',
    deliveryMethod: initialData?.deliveryMethod || 'Electronic',
    additionalNotes: initialData?.additionalNotes || ''
  });

  const [errors, setErrors] = useState<Partial<Record<keyof IntakeFormData, string>>>({});
  
  // File upload states
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'ready' | 'uploaded' | 'error'>('ready');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState<'scanning' | 'classifying'>('scanning');
  const [uploadTimestamp, setUploadTimestamp] = useState<string>('');
  const [showVerification, setShowVerification] = useState(false);
  const [extractedClassification, setExtractedClassification] = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [isClassificationConfirmed, setIsClassificationConfirmed] = useState(false);
  const [requestId, setRequestId] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (field: keyof IntakeFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

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
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
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
        setUploadTimestamp(new Date().toLocaleString());
        // Create preview URL
        const previewUrl = URL.createObjectURL(file);
        setFilePreviewUrl(previewUrl);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (validateFile(file)) {
        setSelectedFile(file);
        setUploadStatus('uploaded');
        setUploadTimestamp(new Date().toLocaleString());
        // Create preview URL
        const previewUrl = URL.createObjectURL(file);
        setFilePreviewUrl(previewUrl);
      }
    }
  };

  const handleUploadIntakeForm = () => {
    if (!selectedFile) {
      alert('Please select an intake form file to upload.');
      return;
    }
    
    // Start the upload progress simulation
    setIsUploading(true);
    setUploadProgress(0);
  };

  // Simulate upload progress
  useEffect(() => {
    if (isUploading) {
      const interval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            setTimeout(() => {
              setIsUploading(false);
              setUploadComplete(true);
            }, 500);
            return 100;
          }
          return prev + 10;
        });
      }, 200);

      return () => clearInterval(interval);
    }
  }, [isUploading]);

  const handleProceedToNextStep = () => {
    if (!selectedFile) {
      alert('Please select a file before proceeding.');
      return;
    }

    // Convert file to base64 and include in the submission
    const reader = new FileReader();
    reader.onloadend = () => {
      const fileData = reader.result as string;
      
      // Proceed to document upload phase with file data
      onSubmit({
        requesterName: '', // Will be extracted from uploaded form
        requesterEmail: '',
        requesterPhone: '',
        requesterOrganization: '',
        caseNumber: `REQ-${Date.now().toString().slice(-6)}`,
        incidentDate: '',
        requestDescription: '',
        redactionCategory: 'Criminal Cases',
        urgencyLevel: 'Standard',
        deliveryMethod: 'Electronic',
        additionalNotes: '',
        fileName: selectedFile.name,
        fileData: fileData,
        fileType: selectedFile.type
      });
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleUploadAgain = () => {
    // Cleanup preview URL
    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
    }
    // Reset all upload states
    setSelectedFile(null);
    setUploadStatus('ready');
    setUploadComplete(false);
    setIsUploading(false);
    setUploadProgress(0);
    setUploadTimestamp('');
    setFilePreviewUrl(null);
  };

  const handleCancelProcessing = () => {
    setIsProcessing(false);
    setProcessingStep('scanning');
  };

  const handleApproveClassification = () => {
    if (!isClassificationConfirmed) {
      alert('Please confirm the classification is correct before proceeding.');
      return;
    }

    // Move to unredacted document upload phase
    setShowVerification(false);
    // Submit the form with all the data
    onSubmit({
      requesterName: '', // Will be extracted from uploaded form
      requesterEmail: '',
      requesterPhone: '',
      requesterOrganization: '',
      caseNumber: requestId,
      incidentDate: '',
      requestDescription: '',
      redactionCategory: extractedClassification === 'Low' ? 'Low Redaction' : extractedClassification === 'Medium' ? 'Medium Redaction' : 'High Redaction',
      urgencyLevel: 'Standard',
      deliveryMethod: 'Electronic',
      additionalNotes: `Classification: ${extractedClassification}`,
      intakeFile: selectedFile
    });
  };

  const handleReclassify = () => {
    // Reset and go back to scanning
    setShowVerification(false);
    setIsClassificationConfirmed(false);
  };

  const validateForm = (): boolean => {
    // Only validate that a file is uploaded
    if (!selectedFile) {
      alert('Please upload an intake form to continue.');
      return false;
    }
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      handleUploadIntakeForm();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Stepper */}
      <CaseStepper currentStep={1} />
      
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

          {/* Show Upload Form or Verification Screen */}
          {!showVerification ? (
            <>
              {/* Intake Form Upload Section */}
              <form onSubmit={handleSubmit}>
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-8">
                  <div className="mb-6">
                    <h2 className="text-slate-900 font-bold mb-3">Upload Intake Form</h2>
                    <p className="text-slate-600">
                      Upload a completed intake form to begin the redaction process. The system will automatically extract the required information.
                    </p>
                  </div>

                  {/* Processing State Overlay */}
                  {isProcessing && selectedFile && (
                    <div className="space-y-6">
                      {/* File Info Card */}
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <FileText className="w-6 h-6 text-blue-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-slate-900 truncate">{selectedFile.name}</p>
                            <p className="text-slate-600">
                              Uploaded {uploadTimestamp}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Processing Status */}
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-8">
                        <div className="flex flex-col items-center text-center space-y-6">
                          {/* Spinner */}
                          <div className="relative">
                            <Loader2 className="w-16 h-16 text-blue-600 animate-spin" />
                          </div>

                          {/* Processing Steps */}
                          <div className="space-y-3 w-full max-w-md">
                            <div className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                              processingStep === 'scanning' ? 'bg-blue-100' : 'bg-white'
                            }`}>
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                processingStep === 'scanning' ? 'bg-blue-600 animate-pulse' : 'bg-slate-300'
                              }`} />
                              <span className={`${
                                processingStep === 'scanning' ? 'text-blue-900' : 'text-slate-600'
                              }`}>
                                Scanning Intake Form...
                              </span>
                            </div>

                            <div className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                              processingStep === 'classifying' ? 'bg-blue-100' : 'bg-white'
                            }`}>
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                processingStep === 'classifying' ? 'bg-blue-600 animate-pulse' : 'bg-slate-300'
                              }`} />
                              <span className={`${
                                processingStep === 'classifying' ? 'text-blue-900' : 'text-slate-600'
                              }`}>
                                Classifying Redaction Level...
                              </span>
                            </div>
                          </div>

                          {/* Progress Text */}
                          <p className="text-slate-600">
                            The system is analyzing your intake form and extracting case information. This may take a few moments.
                          </p>

                          {/* Cancel Button */}
                          <button
                            type="button"
                            onClick={handleCancelProcessing}
                            className="px-6 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-white transition-colors"
                          >
                            Cancel Processing
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Uploading Progress */}
                  {isUploading && selectedFile && (
                    <div className="space-y-6">
                      {/* File Info */}
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <FileText className="w-6 h-6 text-blue-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-slate-900 truncate">{selectedFile.name}</p>
                            <p className="text-slate-600">
                              {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-8">
                        <div className="flex flex-col items-center text-center space-y-6">
                          <div className="relative">
                            <Upload className="w-16 h-16 text-blue-600" />
                          </div>

                          <div className="w-full max-w-md space-y-3">
                            <p className="text-slate-900">Uploading Intake Form...</p>
                            
                            {/* Progress Bar */}
                            <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                              <div
                                className="bg-blue-600 h-full transition-all duration-300 ease-out"
                                style={{ width: `${uploadProgress}%` }}
                              />
                            </div>

                            <p className="text-slate-600">{uploadProgress}% Complete</p>
                          </div>

                          <p className="text-slate-500">
                            Please wait while your intake form is being uploaded...
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Upload Complete */}
                  {uploadComplete && selectedFile && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-8">
                      <div className="flex flex-col items-center text-center space-y-6">
                        {/* Success Icon */}
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                          <CheckCircle2 className="w-10 h-10 text-green-600" />
                        </div>

                        {/* Success Message */}
                        <div className="space-y-2">
                          <h3 className="text-slate-900">Upload Complete!</h3>
                          <p className="text-slate-600">
                            Your intake form has been successfully uploaded.
                          </p>
                        </div>

                        {/* File Details */}
                        <div className="bg-white border border-green-200 rounded-lg p-4 w-full max-w-md">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                              <FileText className="w-5 h-5 text-green-600" />
                            </div>
                            <div className="flex-1 min-w-0 text-left">
                              <p className="text-slate-900 truncate">{selectedFile.name}</p>
                              <p className="text-slate-600">
                                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Upload Area */}
                  {!isProcessing && !isUploading && !uploadComplete && uploadStatus !== 'uploaded' && (
                    <div
                      className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors mb-4 ${
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
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                          uploadStatus === 'error' ? 'bg-red-100' : 'bg-slate-100'
                        }`}>
                          {uploadStatus === 'error' ? (
                            <XCircle className="w-8 h-8 text-red-600" />
                          ) : (
                            <Upload className="w-8 h-8 text-slate-600" />
                          )}
                        </div>

                        {uploadStatus === 'ready' && (
                          <>
                            <div>
                              <p className="text-slate-900 mb-2">
                                Drag and drop your intake form here
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
                          </>
                        )}

                        {uploadStatus === 'error' && (
                          <>
                            <p className="text-red-800 mb-2">
                              Invalid file format or size
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setUploadStatus('ready');
                                setSelectedFile(null);
                              }}
                              className="px-6 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 transition-colors"
                            >
                              Try Again
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

                        <p className="text-slate-500">
                          Allowed formats: .pdf, .jpg, .png, .tiff, .doc, .docx (Max 50MB)
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Document Preview - Show when file is selected */}
                  {!isProcessing && !isUploading && !uploadComplete && uploadStatus === 'uploaded' && selectedFile && filePreviewUrl && (
                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-6 border border-slate-200 p-4 rounded-lg">
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
                          onClick={() => fileInputRef.current?.click()}
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

                  {/* Form Actions */}
                  {!isProcessing && !isUploading && !uploadComplete && (
                    <div className="flex justify-end gap-4">
                      <button
                        type="button"
                        onClick={onBack}
                        className="px-6 py-3 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={uploadStatus !== 'uploaded'}
                        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                      >
                        <Upload className="w-5 h-5" />
                        Upload Intake Form
                      </button>
                    </div>
                  )}
                </div>

                {/* Upload Complete Actions - Outside the card */}
                {uploadComplete && selectedFile && (
                  <div className="flex justify-end gap-4">
                    <button
                      type="button"
                      onClick={handleUploadAgain}
                      className="px-6 py-3 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      Upload Again
                    </button>
                    <button
                      type="button"
                      onClick={handleProceedToNextStep}
                      className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Proceed
                    </button>
                  </div>
                )}
              </form>
            </>
          ) : (
            <>
              {/* Verification Screen */}
              <div className="mb-8">
                <h2 className="text-slate-900 mb-2">Verify Redaction Classification</h2>
                <p className="text-slate-600">
                  Please review the extracted classification to ensure it accurately reflects the redaction requirements.
                </p>
              </div>

              {/* Two-Column Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {/* Left Column - Intake Form Preview */}
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                  <h3 className="text-slate-900 mb-4">Intake Form Preview</h3>
                  
                  {/* Document Preview Placeholder */}
                  <div className="bg-slate-100 border border-slate-300 rounded-lg p-8 mb-4 min-h-[600px] flex flex-col items-center justify-center">
                    <FileText className="w-16 h-16 text-slate-400 mb-4" />
                    <p className="text-slate-600 text-center mb-2">{selectedFile?.name}</p>
                    <p className="text-slate-500 text-center">
                      Document preview not available
                    </p>
                    <p className="text-slate-400 mt-4">
                      {selectedFile && (selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>

                  {/* File Metadata */}
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between py-2 border-b border-slate-200">
                      <span className="text-slate-600">Case Number:</span>
                      <span className="text-slate-900">{caseNumber}</span>
                    </div>
                    <div className="flex justify-between py-2">
                      <span className="text-slate-600">Requester Name:</span>
                      <span className="text-slate-900">{requesterName}</span>
                    </div>
                  </div>
                </div>

                {/* Right Column - Classification */}
                <div className="space-y-6">
                  {/* Classification Panel */}
                  <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                    <h3 className="text-slate-900 mb-4">Extracted Classification</h3>
                    
                    {/* Classification Badge */}
                    <div className={`inline-block px-4 py-2 rounded-lg mb-4 ${
                      extractedClassification === 'Low' ? 'bg-green-100 text-green-800' :
                      extractedClassification === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      <span className="font-medium">{extractedClassification} Redaction Required</span>
                    </div>

                    {/* Classification Dropdown */}
                    <div className="mb-4">
                      <label className="block text-slate-700 mb-2">
                        Redaction Level
                      </label>
                      <select
                        value={extractedClassification}
                        onChange={(e) => setExtractedClassification(e.target.value as 'Low' | 'Medium' | 'High')}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="Low">Low - Minimal redaction required</option>
                        <option value="Medium">Medium - Moderate redaction required</option>
                        <option value="High">High - Extensive redaction required</option>
                      </select>
                    </div>

                    {/* Confirmation Checklist */}
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isClassificationConfirmed}
                          onChange={() => setIsClassificationConfirmed(!isClassificationConfirmed)}
                          className="mt-1 w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                        />
                        <div>
                          <span className="text-slate-900 block">Confirm classification is correct</span>
                          <span className="text-slate-600">
                            I have reviewed the classification level and confirm it accurately reflects the redaction requirements for this document.
                          </span>
                        </div>
                      </label>
                    </div>

                    {/* Info Text */}
                    <p className="text-slate-500 text-sm">
                      The system has automatically classified this request based on the intake form. You can modify the classification using the dropdown above if needed.
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        type="button"
                        onClick={handleReclassify}
                        className="flex-1 px-6 py-3 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        Reclassify
                      </button>
                      <button
                        type="button"
                        onClick={handleApproveClassification}
                        disabled={!isClassificationConfirmed}
                        className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        <CheckCircle2 className="w-5 h-5" />
                        Approve Classification
                      </button>
                    </div>
                    
                    {!isClassificationConfirmed && (
                      <p className="text-slate-500 text-sm mt-3 text-center">
                        Please confirm the classification to proceed
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-4 px-8 text-center mt-8">
        <p>TPD Records Processing System v1.0 | Secure Document Processing</p>
      </footer>
    </div>
  );
}