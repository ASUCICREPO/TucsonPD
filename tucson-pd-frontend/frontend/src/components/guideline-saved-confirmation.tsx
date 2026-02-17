import { CheckCircle2, Home, ArrowLeft } from 'lucide-react';

interface GuidelineSavedConfirmationProps {
  onSetAsActive: () => void;
  onGoToDashboard: () => void;
}

export function GuidelineSavedConfirmation({ 
  onSetAsActive, 
  onGoToDashboard 
}: GuidelineSavedConfirmationProps) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Main Content */}
      <main className="flex-1 px-8 py-8 flex items-center justify-center">
        <div className="max-w-2xl w-full">
          {/* Confirmation Card */}
          <div className="bg-white rounded-lg shadow-lg border border-slate-200 p-12 text-center">
            {/* Large Success Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-16 h-16 text-green-600" />
              </div>
            </div>

            {/* Success Message */}
            <h2 className="text-slate-900 mb-4">Guideline Saved Successfully</h2>

            {/* Subtext */}
            <p className="text-slate-600 mb-8">
              You may now set this guideline as Active.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {/* Secondary Button */}
              <button
                onClick={onGoToDashboard}
                className="px-8 py-3 border-2 border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-5 h-5" />
                Go to Dashboard
              </button>

              {/* Primary Button */}
              <button
                onClick={onSetAsActive}
                className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-5 h-5" />
                Set as Active
              </button>
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