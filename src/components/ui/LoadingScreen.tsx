import { Logo } from '../brand/Logo';

export function LoadingScreen() {
  return (
    <div
      className="bg-app fixed inset-0 z-50 flex items-center justify-center px-4 transition-opacity duration-300 motion-reduce:transition-none"
      role="status"
      aria-label="Fall Split - Developed by Pratham Malkan"
    >
      <div className="flex flex-col items-center text-center">
        <Logo size={48} />
        <h1 className="logo-text mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
          Fall<span className="logo-accent"> Split</span>
        </h1>
        <p className="text-secondary mt-1 text-sm font-medium tracking-wide">
          Developed by Pratham Malkan
        </p>
        <div className="mt-6 flex gap-1.5" aria-hidden="true">
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[rgb(249_115_22)] [animation-delay:0ms] motion-reduce:animate-none" />
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[rgb(249_115_22)] [animation-delay:150ms] motion-reduce:animate-none" />
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[rgb(249_115_22)] [animation-delay:300ms] motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}
