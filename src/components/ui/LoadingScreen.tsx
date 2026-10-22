export function LoadingScreen() {
  return (
    <div
      className="bg-app fixed inset-0 flex items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <div className="flex flex-col items-center gap-4">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <path
            d="M4 20L20 4L36 20"
            stroke="rgb(249 115 22)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 28L20 20L28 28"
            stroke="rgb(249 115 22)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.5"
          />
        </svg>
        <div className="flex gap-1">
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[rgb(249_115_22)] [animation-delay:0ms]" />
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[rgb(249_115_22)] [animation-delay:150ms]" />
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[rgb(249_115_22)] [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}
