import { Link, useLoaderData } from "react-router-dom";

type PostSummary = {
  slug: string;
  title: string;
  excerpt: string;
  author: string;
  publishedAt: string;
};

type HomeLoaderData = {
  posts: PostSummary[];
};

async function loadPosts(request: Request): Promise<HomeLoaderData> {
  const url = new URL(request.url);
  const origin = url.origin;
  const response = await fetch(`${origin}/api/posts`, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw response;
  }

  const posts = (await response.json()) as PostSummary[];
  return { posts };
}

function HomeRouteComponent() {
  const { posts } = useLoaderData() as HomeLoaderData;

  return (
    <section className="post-grid">
      {posts.map((post) => (
        <article key={post.slug} className="post-card">
          <header className="post-card__header">
            <h2 className="post-card__title">
              <Link to={`/posts/${post.slug}`} className="post-card__link">
                {post.title}
              </Link>
            </h2>
            <p className="post-card__meta">
              {post.author} ·{" "}
              {new Date(post.publishedAt).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric"
              })}
            </p>
          </header>
          <p className="post-card__excerpt">{post.excerpt}</p>
          <footer className="post-card__footer">
            <Link to={`/posts/${post.slug}`} className="link-button">
              Read post →
            </Link>
          </footer>
        </article>
      ))}
    </section>
  );
}

export const HomeRoute = {
  loader: ({ request }: { request: Request }) => loadPosts(request),
  Component: HomeRouteComponent
};
