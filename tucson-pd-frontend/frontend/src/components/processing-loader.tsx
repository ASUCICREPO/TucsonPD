import { useEffect, useState } from 'react';
import { Loader2, FileText, Clock } from 'lucide-react';

interface ProcessingLoaderProps {
  title: string;
  description: string;
  /** No longer used for a fake progress bar — kept for API compatibility */
  progress?: number;
  fileName: string;
  caseId: string;
  /**
   * Unix timestamp (seconds) for when processing started.
   * If provided, the elapsed timer begins from the real start time rather
   * than zero — so re-entering the screen mid-process shows the correct time.
   */
  startedAt?: number;
  /** Steps shown as in-progress — none ever falsely complete */
  steps: {
    threshold: number; // kept for API compatibility, ignored
    label: string;
  }[];
}

function useElapsedTime(startedAt?: number) {
  const getInitialSeconds = () =>
    startedAt ? Math.max(0, Math.floor(Date.now() / 1000) - startedAt) : 0;

  const [seconds, setSeconds] = useState(getInitialSeconds);

  useEffect(() => {
    setSeconds(getInitialSeconds());
    const interval = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function ProcessingLoader({
  title,
  description,
  fileName,
  caseId,
  startedAt,
  steps,
}: ProcessingLoaderProps) {
  const elapsed = useElapsedTime(startedAt);

  return (
    <div className="py-12">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-md border border-slate-200 p-12">

        {/* Icon + Title */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
          </div>
          <h2 className="text-slate-900 mb-3">{title}</h2>
          <p className="text-slate-600">{description}</p>
        </div>

        {/* Indeterminate progress bar */}
        <div className="mb-8">
          <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-blue-600 animate-indeterminate" />
          </div>
          <style>{`
            @keyframes indeterminate {
              0%   { transform: translateX(-100%) scaleX(0.4); }
              50%  { transform: translateX(60%)  scaleX(0.6); }
              100% { transform: translateX(200%) scaleX(0.4); }
            }
            .animate-indeterminate {
              width: 50%;
              animation: indeterminate 1.6s ease-in-out infinite;
              transform-origin: left center;
            }
          `}</style>
        </div>

        {/* Steps — all shown as in-progress, none fake-complete */}
        <div className="space-y-3 mb-8">
          {steps.map((step, index) => (
            <div
              key={index}
              className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 text-slate-500"
            >
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin flex-shrink-0" />
              <span>{step.label}</span>
            </div>
          ))}
        </div>

        {/* File + elapsed time */}
        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 flex items-start justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <p className="text-blue-900 truncate">
              {caseId ? `Case ${caseId} — ` : ''}{fileName || 'Document'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-blue-700 flex-shrink-0">
            <Clock className="w-4 h-4" />
            <span className="tabular-nums">{elapsed}</span>
          </div>
        </div>

      </div>
    </div>
  );
}