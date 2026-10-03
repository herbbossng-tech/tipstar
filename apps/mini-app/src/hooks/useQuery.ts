import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../services/api.js";

/**
 * The one data-fetching primitive every Mini App screen uses (Section 09
 * §32 — Data Fetching). Generalizes the race-condition-safe
 * loading/error/data pattern `SettingsPage.tsx` already established
 * (Section 03) into a reusable hook, so no page re-derives it. Guards
 * against the classic race: if `fetcher` changes (a new `deps` value)
 * before the previous call resolves, the stale response is discarded
 * rather than overwriting fresher state — a "generation" counter, not
 * just a boolean, so a THIRD overlapping call can't be clobbered by a
 * late-resolving SECOND one either.
 */
export type QueryState<T> = { readonly status: "loading" } | { readonly status: "success"; readonly data: T } | { readonly status: "error"; readonly code: string; readonly message: string };

export function useQuery<T>(fetcher: () => Promise<T>, deps: readonly unknown[]): QueryState<T> & { readonly refetch: () => void } {
  const [state, setState] = useState<QueryState<T>>({ status: "loading" });
  const generationRef = useRef(0);
  const [refetchToken, setRefetchToken] = useState(0);

  const refetch = useCallback(() => setRefetchToken((token) => token + 1), []);

  useEffect(() => {
    const generation = ++generationRef.current;
    setState({ status: "loading" });

    fetcher()
      .then((data) => {
        if (generationRef.current !== generation) return; // a newer call already superseded this one
        setState({ status: "success", data });
      })
      .catch((error: unknown) => {
        if (generationRef.current !== generation) return;
        const code = error instanceof ApiError ? error.code : "unknown_error";
        const message = error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
        setState({ status: "error", code, message });
      });
  }, [...deps, refetchToken]);

  return { ...state, refetch };
}
