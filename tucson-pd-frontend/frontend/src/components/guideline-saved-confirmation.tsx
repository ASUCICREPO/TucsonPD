import { useState } from 'react';
import { CheckCircle2, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { activateGuideline } from './adminapimanager';

interface GuidelineSavedConfirmationProps {
  guidelineId: string;
  onGoToDashboard: () => void;
}

export function GuidelineSavedConfirmation({
  guidelineId,
  onGoToDashboard,
}: GuidelineSavedConfirmationProps) {
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);

  const handleSetAsActive = async () => {
    setIsActivating(true);
    setError(null);

    const { error: activateError } = await activateGuideline(guidelineId);

    if (activateError) {
      setError(`Failed to activate guideline: ${activateError}`);
      setIsActivating(false);
      return;
    }

    setActivated(true);
    setIsActivating(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <main className="flex-1 px-8 py-8 flex items-center justify-center">
        <div className="max-w-2xl w-full">
          <div className="bg-white rounded-lg shadow-lg border border-slate-200 p-12 text-center">

            {/* Icon */}
            <div className="flex justify-center mb-6">
              <div className={`w-24 h-24 rounded-full flex items-center justify-center ${activated ? 'bg-emerald-100' : 'bg-green-100'}`}>
                <CheckCircle2 className={`w-16 h-16 ${activated ? 'text-emerald-600' : 'text-green-600'}`} />
              </div>
            </div>

            {/* Heading */}
            <h2 className="text-slate-900 mb-4">
              {activated ? 'Guideline Activated' : 'Guideline Saved Successfully'}
            </h2>

            {/* Subtext */}
            <p className="text-slate-600 mb-8">
              {activated
                ? 'This guideline is now active and will be used for all new redaction proposals.'
                : 'Rules have been saved. You can set this guideline as active now, or do it later from the dashboard.'
              }
            </p>

            {/* Error */}
            {error && (
              <div className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-left">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-red-700">{error}</p>
              </div>
            )}

            {/* Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={onGoToDashboard}
                className="px-8 py-3 border-2 border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-5 h-5" />
                Go to Dashboard
              </button>

              {!activated && (
                <button
                  onClick={handleSetAsActive}
                  disabled={isActivating}
                  className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  {isActivating
                    ? <><Loader2 className="w-5 h-5 animate-spin" /> Activating…</>
                    : <><CheckCircle2 className="w-5 h-5" /> Set as Active</>
                  }
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-slate-900 text-slate-400 py-4 px-8 text-center mt-8">
        <p>TPD Records Processing System v1.0 | Secure Document Processing</p>
      </footer>
    </div>
  );
}