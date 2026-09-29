interface Tab {
  key: string;
  label: string;
}

interface DetailTabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  children: React.ReactNode;
}

export default function DetailTabs({ tabs, activeTab, onTabChange, children }: DetailTabsProps) {
  const focusTab = (idx: number) => {
    const el = document.getElementById(`tab-${tabs[idx].key}`);
    el?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = e.key === "ArrowRight" ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
      onTabChange(tabs[next].key);
      focusTab(next);
    }
  };
  return (
    <div>
      <div role="tablist" className="flex border-b border-th-line mb-4">
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            id={`tab-${tab.key}`}
            role="tab"
            aria-selected={activeTab === tab.key}
            tabIndex={activeTab === tab.key ? 0 : -1}
            onClick={() => onTabChange(tab.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "text-th-accent border-b-2 border-th-accent"
                : "text-th-dim hover:text-th-body"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}
