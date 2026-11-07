import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading">
      <div className="space-y-2"><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-full max-w-80" /></div>
      {[0, 1].map((i) => (
        <div key={i} className="panel p-5 space-y-3">
          <Skeleton className="h-4 w-1/3" /><Skeleton className="h-5 w-2/3" /><Skeleton className="h-28 w-full" /><Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}
