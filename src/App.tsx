import { lazy, Suspense, useEffect } from "react";
import { Route, Router, Switch, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { useSongIndex } from "./app/useSongIndex";

// Each screen is its own chunk, so no screen downloads another's code.
const PracticeRoute = lazy(() => import("./app/routes/PracticeRoute"));

/** Routes are in the hash (`#/play/divenire`), so the app works on any static host. */
export function App() {
  return (
    <div className="app">
      <Router hook={useHashLocation}>
        <Switch>
          <Route path="/">
            <Screen>
              <Home />
            </Screen>
          </Route>
          <Route path="/play/:songId">
            {({ songId }) => (
              <Screen key={songId}>
                <PracticeRoute songId={songId} />
              </Screen>
            )}
          </Route>
          <Route>
            <Screen>
              <Home />
            </Screen>
          </Route>
        </Switch>
      </Router>
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="message">Loading…</div>}>{children}</Suspense>
    </ErrorBoundary>
  );
}

/** Until the Library exists (Stage 1), home is the first song in the bank. */
function Home() {
  const index = useSongIndex();
  const [, navigate] = useLocation();
  const first = index.status === "ready" ? index.entries[0]?.id : undefined;
  useEffect(() => {
    if (first) navigate(`/play/${first}`, { replace: true });
  }, [first, navigate]);
  if (index.status === "error") return <div className="message">{index.message}</div>;
  return <div className="message">Loading…</div>;
}
