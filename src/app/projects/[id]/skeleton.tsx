import { Skeleton } from "@/components/ui/skeleton";

/** Shared by `loading.tsx` and the page's own Suspense boundary. */
export function ProjectPageSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-3 w-96" />
      </div>
      <Skeleton className="h-9 w-80 rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-24 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}
