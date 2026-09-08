interface Step {
  title: string;
  optional?: boolean;
}

interface StepWizardProps {
  steps: Step[];
  currentStep: number;
  onStepChange: (step: number) => void;
  onCancel: () => void;
  onSubmit: () => void;
  canProceed?: boolean;
  submitting?: boolean;
  children: React.ReactNode;
}

export default function StepWizard({
  steps,
  currentStep,
  onStepChange,
  onCancel,
  onSubmit,
  canProceed = true,
  submitting,
  children,
}: StepWizardProps) {
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;

  return (
    <div className="flex flex-col h-full">
      {/* Step indicator bar */}
      <div className="flex items-center justify-center py-6 px-4">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <div key={index} className="flex items-center">
              {/* Step circle */}
              <div className="flex flex-col items-center">
                <button
                  onClick={() => {
                    if (index < currentStep) onStepChange(index);
                  }}
                  disabled={index > currentStep}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                    isCurrent
                      ? "bg-th-accent text-white"
                      : isCompleted
                        ? "bg-th-ok text-white cursor-pointer"
                        : "bg-th-subtle text-th-dim cursor-default"
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </button>
                <span
                  className={`mt-1 text-xs whitespace-nowrap ${
                    isCurrent ? "text-th-accent font-medium" : isCompleted ? "text-th-body" : "text-th-dim"
                  }`}
                >
                  {step.title}
                  {step.optional && <span className="text-th-ghost ml-1">(optional)</span>}
                </span>
              </div>

              {/* Connecting line */}
              {index < steps.length - 1 && (
                <div
                  className={`h-0.5 w-16 mx-2 mt-[-1rem] ${
                    index < currentStep ? "bg-th-ok" : "bg-th-subtle"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto px-6 py-4">{children}</div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-th-line px-6 py-4">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-th-dim hover:text-th-body transition-colors"
        >
          Cancel
        </button>
        <div className="flex items-center gap-3">
          {!isFirstStep && (
            <button
              onClick={() => onStepChange(currentStep - 1)}
              className="px-4 py-2 text-sm border border-th-line rounded text-th-body hover:bg-th-hover transition-colors"
            >
              Back
            </button>
          )}
          {isLastStep ? (
            <button
              onClick={onSubmit}
              disabled={!canProceed || submitting}
              className="px-4 py-2 text-sm rounded bg-th-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Submitting..." : "Submit"}
            </button>
          ) : (
            <button
              onClick={() => onStepChange(currentStep + 1)}
              disabled={!canProceed}
              className="px-4 py-2 text-sm rounded bg-th-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
