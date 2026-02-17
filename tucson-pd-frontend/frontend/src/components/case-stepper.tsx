import { Check } from 'lucide-react';

interface CaseStepperProps {
  currentStep: 1 | 2 | 3 | 4;
}

const steps = [
  { number: 1, label: 'Intake Form Upload' },
  { number: 2, label: 'Unredacted Document Upload' },
  { number: 3, label: 'Redaction Review' },
  { number: 4, label: 'Final Document' }
];

export function CaseStepper({ currentStep }: CaseStepperProps) {
  return (
    <div className="bg-white border-b border-slate-200 py-6 px-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-center gap-4">
          {steps.map((step, index) => (
            <div key={step.number} className="flex items-center">
              {/* Step Circle and Label */}
              <div className="flex flex-col items-center relative">
                {/* Circle */}
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    step.number < currentStep
                      ? 'bg-green-600 text-white'
                      : step.number === currentStep
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  {step.number < currentStep ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <span className="font-medium">{step.number}</span>
                  )}
                </div>
                
                {/* Label */}
                <span
                  className={`mt-2 text-sm whitespace-nowrap ${
                    step.number <= currentStep
                      ? 'text-slate-900 font-medium'
                      : 'text-slate-500'
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector Line */}
              {index < steps.length - 1 && (
                <div className="w-24 h-1 mx-4 mb-6">
                  <div
                    className={`h-full transition-colors ${
                      step.number < currentStep
                        ? 'bg-green-600'
                        : 'bg-slate-200'
                    }`}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}