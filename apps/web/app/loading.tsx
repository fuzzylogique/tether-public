import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-8" aria-busy aria-label="Loading">
      <div className="space-y-2"><Skeleton className="h-8 w-56" /><Skeleton className="h-4 w-full max-w-md" /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}
      </div>
    </div>
  );
}
