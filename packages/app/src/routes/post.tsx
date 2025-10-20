import { Link, useLoaderData } from "react-router-dom";

type Post = {
  slug: string;
  title: string;
  author: string;
  publishedAt: string;
  content: string;
};

type PostLoaderData = {
  post: Post;
};

async function loadPost(request: Request, slug: string): Promise<PostLoaderData> {
  const origin = new URL(request.url).origin;
  const response = await fetch(`${origin}/api/posts/${slug}`, {
    headers: { Accept: "application/json" }
  });

  if (response.status === 404) {
    throw new Response("Post not found", { status: 404, statusText: "Not Found" });
  }

  if (!response.ok) {
    throw response;
  }

  const post = (await response.json()) as Post;
  return { post };
}

function PostRouteComponent() {
  const { post } = useLoaderData() as PostLoaderData;

  return (
    <article className="post-article">
      <header className="post-article__header">
        <Link to="/" className="back-link">
          ← Back to posts
        </Link>
        <h2 className="post-article__title">{post.title}</h2>
        <p className="post-article__meta">
          {post.author} ·{" "}
          {new Date(post.publishedAt).toLocaleDateString(undefined, {
            day: "numeric",
            month: "long",
            year: "numeric"
          })}
        </p>
      </header>

      <div className="post-article__body">
        {post.content.split("\n\n").map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    </article>
  );
}

export const PostRoute = {
  loader: ({ request, params }: { request: Request; params: { slug?: string } }) => {
    if (!params.slug) {
      throw new Response("Missing slug", { status: 400, statusText: "Bad Request" });
    }

    return loadPost(request, params.slug);
  },
  Component: PostRouteComponent
};
