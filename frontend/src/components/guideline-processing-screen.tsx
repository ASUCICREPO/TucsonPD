import { Loader2, CheckCircle2 } from 'lucide-react';

interface GuidelineProcessingScreenProps {
  progress: number;
  fileName: string;
}

export function GuidelineProcessingScreen({ progress, fileName }: GuidelineProcessingScreenProps) {
  const steps = [
    { threshold: 25, label: 'Scanning document structure...' },
    { threshold: 50, label: 'Detecting rule categories...' },
    { threshold: 75, label: 'Generating structured JSON...' },
    { threshold: 100, label: 'Finalizing extraction...' }
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Main Content */}
      <main className="flex-1 px-8 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="py-12">
            <div className="bg-white rounded-lg shadow-md border border-slate-200 p-12">
              {/* Processing Icon */}
              <div className="text-center mb-8">
                <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
                </div>

                <h2 className="text-slate-900 mb-3">Extracting Guidelines...</h2>
                <p className="text-slate-600">
                  AI is detecting rule categories and generating structured JSON.
                </p>
              </div>

              {/* Progress Bar */}
              <div className="mb-8">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-600">Progress</span>
                  <span className="text-blue-600">{progress}%</span>
                </div>
                <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* Processing Steps */}
              <div className="space-y-3">
                {steps.map((step, index) => (
                  <div 
                    key={index}
                    className={`flex items-center gap-3 p-3 rounded-lg ${
                      progress >= step.threshold ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-600'
                    }`}
                  >
                    {progress >= step.threshold ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-slate-300" />
                    )}
                    <span>{step.label}</span>
                  </div>
                ))}
              </div>

              {/* Info */}
              <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-blue-900">
                  Processing: {fileName}
                </p>
              </div>
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
