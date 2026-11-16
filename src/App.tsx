import { lazy, Suspense } from "react";
import { Route, Router, Switch } from "wouter";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { useHashPath } from "./app/hashRoute";
import { TopBar } from "./app/TopBar";

// Each screen is its own chunk, so no screen downloads another's code.
const LibraryRoute = lazy(() => import("./library/LibraryRoute"));
const PracticeRoute = lazy(() => import("./app/routes/PracticeRoute"));
const CreditsRoute = lazy(() => import("./app/routes/CreditsRoute"));

/** Routes are in the hash (`#/play/divenire`), so the app works on any static host. */
export function App() {
  return (
    <div className="app">
      <Router hook={useHashPath}>
        <Switch>
          <Route path="/">
            <Screen>
              <LibraryRoute />
            </Screen>
          </Route>
          <Route path="/play/:songId">
            {({ songId }) => (
              <Screen key={songId}>
                <PracticeRoute songId={songId} />
              </Screen>
            )}
          </Route>
          <Route path="/credits">
            <Screen>
              <CreditsRoute />
            </Screen>
          </Route>
          <Route>
            <TopBar />
            <div className="message">
              <p>There’s nothing at this address.</p>
              <p>
                <a href="#/">Go to the songs</a>
              </p>
            </div>
          </Route>
        </Switch>
      </Router>
      <footer className="app-footer">
        <a href="#/credits">Credits</a>
      </footer>
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
