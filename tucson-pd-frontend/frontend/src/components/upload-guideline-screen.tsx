import { useState, useEffect } from 'react';
import { Upload, FileText, ArrowLeft, X } from 'lucide-react';
import { GuidelineProcessingScreen } from './guideline-processing-screen';

interface UploadGuidelineScreenProps {
  onBack: () => void;
  onScanDocument: (file: File) => void;
}

export function UploadGuidelineScreen({ onBack, onScanDocument }: UploadGuidelineScreenProps) {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

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
    if (file && (file.type === 'application/pdf' || 
                 file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                 file.type === 'application/msword')) {
      setUploadedFile(file);
    } else {
      alert('Please upload a PDF or DOCX file');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
    }
  };

  const handleReplaceFile = () => {
    setUploadedFile(null);
  };

  const handleScanDocument = () => {
    if (uploadedFile) {
      setIsProcessing(true);
      setProgress(0);
    }
  };

  // Simulate processing progress
  useEffect(() => {
    if (isProcessing) {
      const interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            setTimeout(() => {
              onScanDocument(uploadedFile!);
            }, 500);
            return 100;
          }
          return prev + 2;
        });
      }, 100);

      return () => clearInterval(interval);
    }
  }, [isProcessing, uploadedFile, onScanDocument]);

  // Show processing screen when processing
  if (isProcessing) {
    return (
      <GuidelineProcessingScreen 
        progress={progress}
        fileName={uploadedFile?.name || ''}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Main Content */}
      <main className="flex-1 px-8 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Back Link */}
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Return to Dashboard
          </button>

          {/* Upload Area */}
          <div className="bg-white rounded-lg shadow-md border border-slate-200 p-8">
            {/* Page Title */}
            <div className="mb-6">
              <h2 className="text-slate-900 mb-2">Upload New Guideline Document</h2>
              <p className="text-slate-600">Upload a guideline document to scan and process</p>
            </div>

            {!uploadedFile ? (
              <>
                {/* Drag and Drop Zone */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                    isDragging
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-slate-300 bg-slate-50'
                  }`}
                >
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
                      <Upload className="w-8 h-8 text-slate-600" />
                    </div>

                    <div>
                      <p className="text-slate-900 mb-2">
                        Drag and drop your file here
                      </p>
                      <p className="text-slate-500">or</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => document.getElementById('file-upload')?.click()}
                      className="px-6 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 transition-colors"
                    >
                      Browse Files
                    </button>

                    <input
                      id="file-upload"
                      type="file"
                      accept=".pdf,.doc,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                      onChange={handleFileSelect}
                      className="hidden"
                    />

                    <p className="text-slate-500">
                      Accepted formats: PDF, DOCX
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* File Preview Card */}
                <div className="mb-8">
                  <h3 className="text-slate-900 mb-4">Uploaded File</h3>
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
                      
                      {/* Replace File Button */}
                      <button
                        onClick={handleReplaceFile}
                        className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors flex-shrink-0 ml-4"
                      >
                        Replace File
                      </button>
                    </div>
                  </div>
                </div>

                {/* Scan Document Button */}
                <div className="flex justify-end">
                  <button
                    onClick={handleScanDocument}
                    className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Scan Document
                  </button>
                </div>
              </>
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