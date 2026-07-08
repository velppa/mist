import { useDocument } from "~/lib/DocumentContext";

export default function OnboardingBanner() {
  const { isOnboarding, clearDocument } = useDocument();

  if (!isOnboarding) return null;

  return (
    <div className="px-4 pt-3">
      <button
        onClick={clearDocument}
        className="w-full cursor-pointer border border-emerald-500 py-1.5 text-sm uppercase tracking-wider text-emerald-600 transition-colors hover:bg-emerald-500 hover:text-white"
      >
        Start editing
      </button>
    </div>
  );
}
