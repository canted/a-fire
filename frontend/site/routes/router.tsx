import { createBrowserRouter } from "react-router-dom";
import { SiteLayout } from "../layouts/SiteLayout";
import { SitePage } from "../features/site/SitePage";
import { NotFound } from "../layouts/components/NotFound";
export const router = createBrowserRouter([{ path: "/", element: <SiteLayout />, children: [
  { index: true, element: <SitePage /> }, { path: "*", element: <NotFound /> },
] }]);
