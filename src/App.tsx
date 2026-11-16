import { lazy, Suspense } from "react";
import { Route, Router, Switch } from "wouter";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { useFlag } from "./app/flags";
import { useHashPath } from "./app/hashRoute";
import { TopBar } from "./app/TopBar";

// Each screen is its own chunk, so no screen downloads another's code.
const LibraryRoute = lazy(() => import("./library/LibraryRoute"));
const PracticeRoute = lazy(() => import("./app/routes/PracticeRoute"));
const CreditsRoute = lazy(() => import("./app/routes/CreditsRoute"));
const StudioRoute = lazy(() => import("./studio/StudioRoute"));
const SettingsRoute = lazy(() => import("./app/settings/SettingsRoute"));

/** Routes are in the hash (`#/play/divenire`), so the app works on any static host. */
export function App() {
  // Unfinished stages hide behind a flag: with it off, their addresses do not exist.
  const studio = useFlag("studio");
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
          {studio && (
            <Route path="/studio">
              <Screen>
                <StudioRoute />
              </Screen>
            </Route>
          )}
          {studio && (
            <Route path="/studio/:projectId">
              {({ projectId }) => (
                <Screen key={projectId}>
                  <StudioRoute projectId={projectId} />
                </Screen>
              )}
            </Route>
          )}
          {studio && (
            <Route path="/settings">
              <Screen>
                <SettingsRoute />
              </Screen>
            </Route>
          )}
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
