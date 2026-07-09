import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { RegistryEntry } from "~/shared/types";
import { effectiveFormat, docAliasPath } from "~/shared/constants";

type SortKey = "title" | "format" | "author" | "listed" | "updatedAt";
type SortDir = "asc" | "desc";

function formatDate(timestamp: number): string {
  // Fixed ISO date keeps server and client renders identical
  return new Date(timestamp).toISOString().slice(0, 10);
}

function compare(a: RegistryEntry, b: RegistryEntry, key: SortKey): number {
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title);
    case "format":
      return effectiveFormat(a.format).localeCompare(effectiveFormat(b.format));
    case "author":
      return (a.author ?? "").localeCompare(b.author ?? "");
    case "listed":
      return Number(a.listed) - Number(b.listed);
    case "updatedAt":
      return a.updatedAt - b.updatedAt;
  }
}

function SortHeader({
  label,
  sort,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  sort: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === sort;
  return (
    <th className="py-2 pr-4 text-left">
      <button
        onClick={() => onSort(sort)}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
        className="cursor-pointer whitespace-nowrap font-mono font-light uppercase tracking-wider text-muted transition-colors hover:text-ink"
      >
        {label}
        {active ? (sortDir === "asc" ? " \u2191" : " \u2193") : ""}
      </button>
    </th>
  );
}

/**
 * Sortable document listing shared by the homepage and My docs.
 * Sorting is per-view client state; default is newest first.
 */
export default function DocTable({
  documents,
  showAuthor = false,
  showListed = false,
  renderActions,
}: {
  documents: RegistryEntry[];
  showAuthor?: boolean;
  showListed?: boolean;
  renderActions?: (doc: RegistryEntry) => React.ReactNode;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const copy = [...documents];
    copy.sort((a, b) => {
      const cmp = compare(a, b, sortKey);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [documents, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "updatedAt" ? "desc" : "asc");
    }
  }

  const header = (label: string, sort: SortKey) => (
    <SortHeader
      label={label}
      sort={sort}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={handleSort}
    />
  );

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-border">
          {header("Title", "title")}
          {header("Format", "format")}
          {showAuthor && header("Author", "author")}
          {showListed && header("Status", "listed")}
          {header("Date", "updatedAt")}
          {renderActions && <th />}
        </tr>
      </thead>
      <tbody>
        {sorted.map((doc) => (
          <tr key={doc.id} className="border-t border-border">
            <td className="w-full py-2 pr-4">
              <Link
                to={docAliasPath(doc.id, doc.title, effectiveFormat(doc.format))}
                className="block text-ink transition-colors hover:text-coral"
              >
                {doc.title}
              </Link>
            </td>
            <td className="whitespace-nowrap py-2 pr-8 font-mono text-sm uppercase tracking-wider text-muted">
              {effectiveFormat(doc.format)}
            </td>
            {showAuthor && (
              <td className="whitespace-nowrap py-2 pr-4 text-muted">
                {doc.author ?? ""}
              </td>
            )}
            {showListed && (
              <td className="whitespace-nowrap py-2 pr-4 font-mono text-sm uppercase tracking-wider text-muted">
                {doc.listed ? "listed" : "unlisted"}
              </td>
            )}
            <td className="whitespace-nowrap py-2 font-mono text-base text-muted">
              <time dateTime={new Date(doc.updatedAt).toISOString()}>
                {formatDate(doc.updatedAt)}
              </time>
            </td>
            {renderActions && (
              <td className="whitespace-nowrap py-2 pl-4 text-right">
                {renderActions(doc)}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
