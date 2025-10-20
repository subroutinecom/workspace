import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { AboutRoute } from "./routes/about";
import { HomeRoute } from "./routes/home";
import { PostRoute } from "./routes/post";
import { RootRoute } from "./routes/root";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <RootRoute.Component />,
    errorElement: <RootRoute.ErrorBoundary />,
    children: [
      {
        index: true,
        loader: HomeRoute.loader,
        element: <HomeRoute.Component />
      },
      {
        path: "posts/:slug",
        loader: PostRoute.loader,
        element: <PostRoute.Component />
      },
      {
        path: "about",
        element: <AboutRoute.Component />
      }
    ]
  }
]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
