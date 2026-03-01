import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

export function useLiveQuery<T>(
  querier: () => Promise<T> | T,
  deps: unknown[],
  defaultValue: T
): T {
  const [value, setValue] = useState<T>(defaultValue);

  useEffect(() => {
    const subscription = liveQuery(querier).subscribe({
      next: (result) => setValue(result),
      error: (error) => {
        console.error("Dexie liveQuery error", error);
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, deps);

  return value;
}
