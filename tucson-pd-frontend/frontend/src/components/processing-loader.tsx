import { CheckCircle2, Loader2 } from 'lucide-react';

interface ProcessingLoaderProps {
  title: string;
  description: string;
  progress: number;
  fileName: string;
  caseId: string;
  steps: {
    threshold: number;
    label: string;
  }[];
}

export function ProcessingLoader({ 
  title, 
  description, 
  progress, 
  fileName, 
  caseId,
  steps 
}: ProcessingLoaderProps) {
  return (
    <div className="py-12">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-md border border-slate-200 p-12">
        {/* Processing Icon */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
          </div>

          <h2 className="text-slate-900 mb-3">{title}</h2>
          <p className="text-slate-600">
            {description}
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
            Processing{caseId ? ` case: ${caseId} - ` : ': '}{fileName}
          </p>
        </div>
      </div>
    </div>
  );
}
