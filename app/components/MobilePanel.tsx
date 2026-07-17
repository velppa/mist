import { useState, useEffect, useRef } from "react";
import CommentInput from "~/components/CommentInput";
import ThreadList from "~/components/ThreadList";
import SuggestionActions from "~/components/SuggestionActions";
import ModeToggle from "~/components/ModeToggle";
import PreviewToggle from "~/components/PreviewToggle";
import OnboardingBanner from "~/components/OnboardingBanner";
import { useDocument } from "~/lib/DocumentContext";

type Tab = "editing" | "comments" | "preview";

const tabs: { id: Tab; label: string }[] = [
  { id: "editing", label: "Editing" },
  { id: "comments", label: "Comments" },
  { id: "preview", label: "Preview" },
];

export default function MobilePanel({ className }: { className?: string }) {
  const { activeThreadId, showPreview } = useDocument();
  // Initial tab follows the URL view mode so shared links open in preview
  const [activeTab, setActiveTab] = useState<Tab | null>(
    showPreview ? "preview" : "editing",
  );
  const prevThreadIdRef = useRef(activeThreadId);

  // Switch to comments tab when a thread is activated (e.g. clicking in editor)
  useEffect(() => {
    if (activeThreadId && activeThreadId !== prevThreadIdRef.current) {
      setActiveTab("comments"); // eslint-disable-line react-hooks/set-state-in-effect
    }
    prevThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const collapsed = activeTab === null;

  const handleTabPress = (id: Tab) => {
    setActiveTab(activeTab === id ? null : id);
  };

  return (
    <div
      className={`flex shrink-0 flex-col border-t border-border bg-paper ${className ?? ""}`}
      style={collapsed ? undefined : { maxHeight: "33vh" }}
    >
      <div className={`flex shrink-0 gap-2 px-3 pt-3 ${collapsed ? "pb-3" : "pb-2"}`}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabPress(tab.id)}
            className={`cursor-pointer rounded-full px-4 py-1.5 text-sm uppercase tracking-wider transition-colors ${
              activeTab === tab.id ? "bg-ink text-paper" : "text-muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {activeTab === "editing" && (
            <>
              <OnboardingBanner />
              <ModeToggle />
              <SuggestionActions />
            </>
          )}
          {activeTab === "comments" && (
            <>
              <CommentInput />
              <ThreadList />
            </>
          )}
          {activeTab === "preview" && (
            <PreviewToggle />
          )}
        </div>
      )}
    </div>
  );
}
