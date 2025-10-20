import { Link, Outlet, isRouteErrorResponse, useRouteError } from "react-router-dom";

function RootLayout() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-badge">React Router 7</div>
        <h1 className="site-title">Dockside blog</h1>
        <p className="site-tagline">Tiny sample that hot reloads in Docker with PM2 on watch.</p>
        <nav className="site-nav">
          <Link to="/" className="nav-link">
            Home
          </Link>
          <Link to="/about" className="nav-link">
            About
          </Link>
          <a href="https://reactrouter.com" target="_blank" rel="noreferrer" className="nav-link">
            Docs
          </a>
        </nav>
      </header>

      <main className="app-content">
        <Outlet />
      </main>

      <footer className="site-footer">
        Frontend uses Vite HMR. Backend restarts via PM2 watching <code>server/</code>.
      </footer>
    </div>
  );
}

function RootErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div className="error-panel">
        <h2 className="error-title">
          {error.status} {error.statusText}
        </h2>
        {error.data ? <p className="error-message">{error.data}</p> : null}
        <Link to="/" className="nav-link">
          Go back home
        </Link>
      </div>
    );
  }

  if (error instanceof Error) {
    return (
      <div className="error-panel">
        <h2 className="error-title">Something went wrong.</h2>
        <p className="error-message">{error.message}</p>
        <Link to="/" className="nav-link">
          Go back home
        </Link>
      </div>
    );
  }

  return (
    <div className="error-panel">
      <h2 className="error-title">Unexpected state.</h2>
      <Link to="/" className="nav-link">
        Go back home
      </Link>
    </div>
  );
}

export const RootRoute = {
  Component: RootLayout,
  ErrorBoundary: RootErrorBoundary
};
