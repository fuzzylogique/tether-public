import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading">
      <div className="space-y-2"><Skeleton className="h-8 w-40" /><Skeleton className="h-4 w-full max-w-80" /></div>
      <div className="panel divide-y rule">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="px-5 py-4 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-48" /></div>
        ))}
      </div>
    </div>
  );
}
