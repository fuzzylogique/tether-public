import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-8" aria-busy aria-label="Loading">
      <div className="space-y-2"><Skeleton className="h-8 w-64" /><Skeleton className="h-4 w-full max-w-96" /></div>
      <Skeleton className="h-28 w-full" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-56" />)}
      </div>
    </div>
  );
}
