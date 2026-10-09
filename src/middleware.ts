import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: [
    "/",
    "/new",
    "/dashboard/:path*",
    "/review/:path*",
    "/problems/:path*",
    "/puzzles/:path*",
    "/parta/:path*",
    "/runbooks/:path*",
    "/compare/:path*",
    "/team/:path*",
    "/templates/:path*",
  ],
};
