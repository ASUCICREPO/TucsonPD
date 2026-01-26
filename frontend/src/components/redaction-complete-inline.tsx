import { CheckCircle2, ShieldCheck, Eye, FileText, Download, RotateCcw, ArrowLeft } from 'lucide-react';

interface RedactionStats {
  namesRedacted: number;
  addressesRedacted: number;
  phoneNumbersRedacted: number;
  identifiersRedacted: number;
  totalRedactions: number;
}

interface RedactionCompleteInlineProps {
  fileName: string;
  classificationLevel: string;
  redactionStats: RedactionStats;
  isMarkedComplete: boolean;
  onDownload: () => void;
  onRetry: () => void;
  onComplete: () => void;
  onGoToDashboard: () => void;
}

export function RedactionCompleteInline({ 
  fileName, 
  classificationLevel, 
  redactionStats,
  isMarkedComplete,
  onDownload, 
  onRetry, 
  onComplete,
  onGoToDashboard
}: RedactionCompleteInlineProps) {
  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-slate-900">Redaction Complete</h3>
            <p className="text-slate-600">All redactions applied based on TPD Redaction Guidelines for Standard.</p>
          </div>
        </div>
      </div>

      {/* Redaction Summary Section - Moved to Top */}
      <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
        <h4 className="text-slate-900 mb-6">Redaction Summary</h4>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 text-center">
            <div className="mb-2">
              <span className="text-blue-900">{redactionStats.namesRedacted}</span>
            </div>
            <p className="text-blue-700">Names Redacted</p>
          </div>

          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 text-center">
            <div className="mb-2">
              <span className="text-blue-900">{redactionStats.addressesRedacted}</span>
            </div>
            <p className="text-blue-700">Addresses Redacted</p>
          </div>

          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 text-center">
            <div className="mb-2">
              <span className="text-blue-900">{redactionStats.phoneNumbersRedacted}</span>
            </div>
            <p className="text-blue-700">Phone Numbers Redacted</p>
          </div>

          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 text-center">
            <div className="mb-2">
              <span className="text-blue-900">{redactionStats.identifiersRedacted}</span>
            </div>
            <p className="text-blue-700">IDs Redacted</p>
          </div>
        </div>
      </div>

      {/* Before/After Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Panel - Original Document */}
        <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-200">
            <FileText className="w-5 h-5 text-slate-600" />
            <h4 className="text-slate-900">Original Document</h4>
          </div>

          {/* Original Document Preview */}
          <div className="space-y-4">
            {/* Page 1 Original */}
            <div className="bg-slate-100 rounded-lg border-2 border-slate-300 p-4">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-400">
                <span className="text-slate-700">Page 1</span>
                <Eye className="w-4 h-4 text-slate-600" />
              </div>
              <div className="space-y-2 text-slate-700">
                <div className="bg-white p-2 rounded text-sm">
                  <p className="mb-1">Police Report - Incident #2024-1156</p>
                  <p>Date: March 15, 2024</p>
                </div>
                <div className="bg-white p-2 rounded text-sm">
                  <p className="text-slate-900">Reporting Officer: Detective Sarah Martinez</p>
                </div>
                <div className="bg-white p-2 rounded text-sm">
                  <p>Location: Downtown District</p>
                </div>
                <div className="bg-white p-2 rounded text-sm">
                  <p className="text-slate-900">Witness: John Anderson</p>
                  <p className="text-slate-900">Contact: (555) 123-4567</p>
                </div>
              </div>
            </div>

            {/* Page 2 Original */}
            <div className="bg-slate-100 rounded-lg border-2 border-slate-300 p-4">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-400">
                <span className="text-slate-700">Page 2</span>
                <Eye className="w-4 h-4 text-slate-600" />
              </div>
              <div className="space-y-2 text-slate-700">
                <div className="bg-white p-2 rounded text-sm">
                  <p className="mb-1">Incident Details (continued)</p>
                </div>
                <div className="bg-white p-2 rounded text-sm">
                  <p className="text-slate-900">Suspect: Michael Roberts</p>
                  <p className="text-slate-900">Address: 123 W. Grant Road, Apt 4B</p>
                  <p className="text-slate-900">DOB: 07/22/1985</p>
                </div>
                <div className="bg-white p-2 rounded text-sm">
                  <p>Evidence collected at scene</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel - Redacted Document */}
        <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <h4 className="text-slate-900">Redacted Document</h4>
            </div>
            <button
              onClick={onDownload}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download PDF
            </button>
          </div>

          {/* Redacted Document Preview */}
          <div className="space-y-4">
            {/* Page 1 Redacted */}
            <div className="bg-slate-100 rounded-lg border-2 border-emerald-300 p-4">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-400">
                <span className="text-slate-700">Page 1</span>
                <Eye className="w-4 h-4 text-slate-600" />
              </div>
              <div className="space-y-2 text-slate-700">
                <div className="bg-white p-2 rounded text-sm">
                  <p className="mb-1">Police Report - Incident #2024-1156</p>
                  <p>Date: March 15, 2024</p>
                </div>
                <div className="bg-white p-2 rounded text-sm">
                  <p className="text-slate-900">
                    Reporting Officer: <span className="inline-block bg-slate-900 text-slate-900 select-none px-8 py-0.5 text-xs">REDACTED</span>
                  </p>
                </div>
                <div className="bg-white p-2 rounded text-sm">
                  <p>Location: Downtown District</p>
                </div>
                <div className="bg-white p-2 rounded text-sm">
                  <p className="text-slate-900">
                    Witness: <span className="inline-block bg-slate-900 text-slate-900 select-none px-8 py-0.5 text-xs">REDACTED</span>
                  </p>
                  <p className="text-slate-900">
                    Contact: <span className="inline-block bg-slate-900 text-slate-900 select-none px-8 py-0.5 text-xs">REDACTED</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Page 2 Redacted */}
            <div className="bg-slate-100 rounded-lg border-2 border-emerald-300 p-4">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-400">
                <span className="text-slate-700">Page 2</span>
                <Eye className="w-4 h-4 text-slate-600" />
              </div>
              <div className="space-y-2 text-slate-700">
                <div className="bg-white p-2 rounded text-sm">
                  <p className="mb-1">Incident Details (continued)</p>
                </div>
                <div className="bg-white p-2 rounded text-sm">
                  <p className="text-slate-900">
                    Suspect: <span className="inline-block bg-slate-900 text-slate-900 select-none px-8 py-0.5 text-xs">REDACTED</span>
                  </p>
                  <p className="text-slate-900">
                    Address: <span className="inline-block bg-slate-900 text-slate-900 select-none px-12 py-0.5 text-xs">REDACTED</span>
                  </p>
                  <p className="text-slate-900">
                    DOB: <span className="inline-block bg-slate-900 text-slate-900 select-none px-8 py-0.5 text-xs">REDACTED</span>
                  </p>
                </div>
                <div className="bg-white p-2 rounded text-sm">
                  <p>Evidence collected at scene</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      {!isMarkedComplete ? (
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={onRetry}
            className="px-6 py-3 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors flex items-center gap-2"
          >
            <RotateCcw className="w-5 h-5" />
            Retry Redaction
          </button>

          <button
            onClick={onComplete}
            className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            Mark as Complete
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
              <div>
                <p className="text-emerald-900 mb-1">Redaction Completed</p>
                <p className="text-emerald-800">
                  This redaction has been marked as completed and cannot be edited further. You can download the redacted document or return to the dashboard.
                </p>
              </div>
            </div>
          </div>

          {/* Go to Dashboard Button */}
          <div className="flex justify-center">
            <button
              onClick={onGoToDashboard}
              className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <ArrowLeft className="w-5 h-5" />
              Go to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}