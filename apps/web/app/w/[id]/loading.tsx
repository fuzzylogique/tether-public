import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading">
      <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-64" /><Skeleton className="h-4 w-40" /></div>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-36 w-full" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
