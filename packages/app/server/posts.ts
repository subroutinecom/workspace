export type PostSummary = {
  slug: string;
  title: string;
  excerpt: string;
  author: string;
  publishedAt: string;
};

export type Post = PostSummary & {
  content: string;
};

const posts: Post[] = [
  {
    slug: "lifting-your-dev-env-into-docker",
    title: "Lifting your dev env into Docker",
    excerpt:
      "Bind mounts, PM2, and React Router make for a powerful live-reload setup. Here is how the pieces fit together.",
    author: "G. Dockwright",
    publishedAt: "2024-04-30T09:00:00.000Z",
    content: [
      "Local development inside Docker avoids the 'works on my machine' trap by aligning tooling with production.",
      "In this starter we run both the frontend and backend in a single container. Source code is bind-mounted so edits in your IDE flow straight into the container.",
      "PM2 watches the server folder and restarts the Express API on change, while Vite handles fast client refreshes."
    ].join("\n\n")
  },
  {
    slug: "routing-with-react-router-7",
    title: "Routing with React Router 7",
    excerpt:
      "React Router 7 streamlines data loading and error handling. We lean on loaders for declarative data fetching.",
    author: "R. Outer",
    publishedAt: "2024-05-18T12:30:00.000Z",
    content: [
      "Route loaders remove the boilerplate of fetching data in components. Each route exports a loader that React Router calls before rendering.",
      "We fetch blog content from the Express API and surface loader results using useLoaderData. If the API returns a 404 we bubble that up with a Response throw.",
      "Error boundaries render friendly feedback without losing the SPA feel."
    ].join("\n\n")
  },
  {
    slug: "pm2-watchless-frontends",
    title: "PM2 + watchless frontends",
    excerpt:
      "Let PM2 handle API restarts while Vite keeps the UI reactive. No double restarts, no accidental thrash.",
    author: "P. Monitor",
    publishedAt: "2024-05-26T19:00:00.000Z",
    content: [
      "It is tempting to watch the entire repository with PM2, but that duplicates what Vite already does well.",
      "By constraining watch paths to server files we gain deterministic restarts without starving the CPU.",
      "Want to extend this setup? Add more API routes under server/ and PM2 keeps them live."
    ].join("\n\n")
  }
];

export function listPostSummaries(): PostSummary[] {
  return posts.map(({ slug, title, excerpt, author, publishedAt }) => ({
    slug,
    title,
    excerpt,
    author,
    publishedAt
  }));
}

export function findPostBySlug(slug: string): Post | undefined {
  return posts.find((post) => post.slug === slug);
}
