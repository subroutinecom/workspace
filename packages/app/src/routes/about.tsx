function AboutRouteComponent() {
  return (
    <article className="about-page">
      <h2 className="page-heading">Why this exists</h2>
      <p>
        This sandbox demonstrates how to run a React Router 7 application inside Docker while PM2
        keeps a lightweight Express API alive. The container mounts your working tree so edits in
        VS Code immediately show up via Vite&apos;s hot module reload on the frontend and a quick
        server restart on the backend.
      </p>
      <p>
        Try editing files under <code>src/</code> for UI tweaks and <code>server/</code> for API
        logic. PM2 only watches the server folder so frontend refreshes are handled by Vite.
      </p>
    </article>
  );
}

export const AboutRoute = {
  Component: AboutRouteComponent
};
